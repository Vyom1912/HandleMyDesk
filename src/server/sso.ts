import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { db, initialsOf } from './db';
import { generateToken } from './auth';
import { User } from '../types';

/*
 * Company single sign-on with OpenID Connect (works with Microsoft Entra ID / Microsoft 365,
 * Google Workspace, Okta and others). Configured in .env:
 *
 *   SSO_ISSUER          e.g. https://login.microsoftonline.com/<tenant-id>/v2.0 or https://accounts.google.com
 *   SSO_CLIENT_ID       from the app registration
 *   SSO_CLIENT_SECRET   from the app registration
 *   SSO_REDIRECT_URL    https://<your NovaDesk address>/api/auth/sso/callback
 *   SSO_LABEL           button text, e.g. "Microsoft" (default "your company account")
 *   SSO_AUTO_CREATE     true: people without a NovaDesk account get one (as Members) at first sign-in
 *
 * Flow: authorization code with PKCE. After the provider sends the person back, NovaDesk hands the
 * browser a one-time code (valid 60 seconds) that the app exchanges for its normal sign-in token.
 */

interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  label: string;
  autoCreate: boolean;
}

// Read per request so settings changes (and tests) take effect without restarting
function config(): SsoConfig | null {
  const { SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET, SSO_REDIRECT_URL } = process.env;
  if (!SSO_ISSUER || !SSO_CLIENT_ID || !SSO_CLIENT_SECRET || !SSO_REDIRECT_URL) return null;
  return {
    issuer: SSO_ISSUER.replace(/\/$/, ''),
    clientId: SSO_CLIENT_ID,
    clientSecret: SSO_CLIENT_SECRET,
    redirectUrl: SSO_REDIRECT_URL,
    label: process.env.SSO_LABEL || 'your company account',
    autoCreate: process.env.SSO_AUTO_CREATE === 'true',
  };
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, { doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet>; at: number }>();

async function discover(issuer: string) {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < 3600_000) return cached;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Could not read the sign-in provider's settings (${res.status})`);
  const doc = (await res.json()) as Discovery;
  const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
  discoveryCache.set(issuer, entry);
  return entry;
}

// Short-lived, single-use state kept in memory (one server process)
const pendingLogins = new Map<string, { verifier: string; nonce: string; at: number }>();
const oneTimeCodes = new Map<string, { userId: string; at: number }>();
const LOGIN_TTL = 10 * 60_000;
const CODE_TTL = 60_000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pendingLogins) if (now - v.at > LOGIN_TTL) pendingLogins.delete(k);
  for (const [k, v] of oneTimeCodes) if (now - v.at > CODE_TTL) oneTimeCodes.delete(k);
}

const random = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('base64url');

// Back to the app with an error the sign-in page shows
const fail = (res: Response, message: string) => res.redirect(302, `/#/sso-error/${encodeURIComponent(message)}`);

function emailFrom(claims: JWTPayload): string | null {
  const candidate = [claims.email, claims.preferred_username, claims.upn].find((v) => typeof v === 'string' && v.includes('@'));
  return candidate ? (candidate as string).toLowerCase() : null;
}

function createUser(name: string, email: string): User {
  const user: User = {
    id: `emp-${crypto.randomUUID().slice(0, 8)}`,
    name,
    email,
    avatar: '',
    role: 'member',
    title: 'Team member',
    department: 'General',
    status: 'active',
    phone: '',
    initials: initialsOf(name),
    active: true,
  };
  db.getData().users.push(user);
  db.save();
  // Signs in with SSO only: the password is random and never shown to anyone
  db.setPasswordHash(user.id, bcrypt.hashSync(random(), 10));
  return user;
}

export const ssoRouter = Router();

ssoRouter.get('/api/auth/sso/config', (req, res) => {
  const c = config();
  res.json(c ? { enabled: true, label: c.label } : { enabled: false });
});

ssoRouter.get('/api/auth/sso/start', async (req, res) => {
  const c = config();
  if (!c) return fail(res, 'Single sign-on is not set up');
  try {
    const { doc } = await discover(c.issuer);
    sweep();
    const state = random();
    const nonce = random();
    const verifier = random();
    pendingLogins.set(state, { verifier, nonce, at: Date.now() });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: c.redirectUrl,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: sha256(verifier),
      code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, url.toString());
  } catch (err: any) {
    console.error('SSO start failed:', err);
    fail(res, 'The sign-in provider could not be reached. Try again, or sign in with your password.');
  }
});

ssoRouter.get('/api/auth/sso/callback', async (req: Request, res: Response) => {
  const c = config();
  if (!c) return fail(res, 'Single sign-on is not set up');
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (error) return fail(res, error_description || 'Sign-in was cancelled');

  const pending = state ? pendingLogins.get(state) : undefined;
  if (state) pendingLogins.delete(state);
  if (!code || !pending || Date.now() - pending.at > LOGIN_TTL) {
    return fail(res, 'That sign-in link expired. Please try again.');
  }

  try {
    const { doc, jwks } = await discover(c.issuer);
    const tokenRes = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: c.redirectUrl,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        code_verifier: pending.verifier,
      }),
    });
    const tokens = (await tokenRes.json()) as { id_token?: string; error?: string };
    if (!tokenRes.ok || !tokens.id_token) throw new Error(tokens.error || `Token request failed (${tokenRes.status})`);

    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: doc.issuer, audience: c.clientId });
    if (payload.nonce !== pending.nonce) throw new Error('Sign-in response did not match this request');
    if (payload.email_verified === false) return fail(res, 'Your email address is not verified with the sign-in provider.');

    const email = emailFrom(payload);
    if (!email) return fail(res, 'The sign-in provider did not share an email address.');

    let user = db.getData().users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      if (!c.autoCreate) return fail(res, `There's no NovaDesk account for ${email}. Ask an administrator to add you.`);
      user = createUser(typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email.split('@')[0], email);
    }
    if (user.active === false) return fail(res, 'This account has been deactivated. Ask an administrator.');

    sweep();
    const oneTime = random();
    oneTimeCodes.set(oneTime, { userId: user.id, at: Date.now() });
    res.redirect(302, `/#/sso/${oneTime}`);
  } catch (err: any) {
    console.error('SSO callback failed:', err);
    fail(res, 'Sign-in could not be completed. Try again, or sign in with your password.');
  }
});

ssoRouter.post('/api/auth/sso/exchange', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const entry = oneTimeCodes.get(code);
  oneTimeCodes.delete(code);
  const user = entry && Date.now() - entry.at <= CODE_TTL ? db.getData().users.find((u) => u.id === entry.userId) : undefined;
  if (!user || user.active === false) {
    res.status(401).json({ error: 'That sign-in expired. Please try again.' });
    return;
  }
  res.json({ user, token: generateToken(user), mustChangePassword: false });
});
