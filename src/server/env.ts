// Loads settings from .env before any other server module reads process.env.
// Import this first. Values already set in the environment win over the file.
import { config } from 'dotenv';

config({ quiet: true });
