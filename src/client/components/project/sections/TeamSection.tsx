import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { User } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { Modal } from '../../ui/Modal';
import { Avatar, Tag, label } from '../../ui/Badges';
import { Button, Field, IconButton, selectClass } from '../../ui/Field';

export const TeamSection: React.FC = () => {
  const { projectId, project, teamMembers, setTeamMembers, tasks, canManage, reload } = useProject();
  const { allEmployees, confirm, showToast, refreshEmployees, currentUser, navigate } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState('');

  // Everyone active in the office who isn't on the project yet (never the HandleMyDesk support account)
  const candidates = allEmployees.filter((emp) => emp.active !== false && emp.id !== 'hmd-support' && !teamMembers.some((m) => m.id === emp.id));
  const openAdd = () => {
    setSelected('');
    setAddOpen(true);
    // People added on the Team page (maybe on another device) appear without reloading
    refreshEmployees().catch(() => {});
  };
  const sorted = [...teamMembers].sort((a, b) => Number(b.id === project.leadId) - Number(a.id === project.leadId) || a.name.localeCompare(b.name));

  const add = async () => {
    if (!selected) return;
    try {
      const updated = await api.post<User[]>(`/api/projects/${projectId}/team`, { employeeId: selected });
      setTeamMembers(updated);
      setAddOpen(false);
      setSelected('');
      reload('project', 'activity').catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Failed to add member', 'error');
    }
  };

  const remove = async (member: User) => {
    const openCount = tasks.filter((t) => t.assigneeId === member.id && t.status !== 'done').length;
    const ok = await confirm({
      title: `Remove ${member.name}?`,
      message: `They will lose access to this project.${openCount ? ` They still have ${openCount} open task${openCount === 1 ? '' : 's'} here, which will stay assigned to them.` : ''}`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/projects/${projectId}/team/${member.id}`);
      setTeamMembers((list) => list.filter((m) => m.id !== member.id));
      reload('project', 'activity').catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-fg-muted">{teamMembers.length} people on this project.</p>
        {canManage && (
          <Button onClick={openAdd}>
            <UserPlus size={15} /> Add member
          </Button>
        )}
      </div>

      <ul className="border border-line rounded-lg divide-y divide-line">
        {sorted.map((member) => {
          const isLead = member.id === project.leadId;
          const open = tasks.filter((t) => t.assigneeId === member.id && t.status !== 'done').length;
          return (
            <li key={member.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-subtle">
              <Avatar src={member.avatar} name={member.name} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg truncate">{member.name}</span>
                  {isLead && <Tag tone="blue">Lead</Tag>}
                </div>
                <div className="text-meta text-fg-faint truncate">
                  {member.title} · {member.department}
                </div>
              </div>
              <span className="hidden sm:block text-meta text-fg-muted w-24 text-right">
                {open} open task{open === 1 ? '' : 's'}
              </span>
              <span className="hidden md:block text-meta text-fg-faint w-32 text-right">{label(member.role)}</span>
              <div className="w-7">
                {canManage && !isLead && (
                  <IconButton label={`Remove ${member.name} from project`} danger onClick={() => remove(member)} className="hover-reveal">
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add team member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            {candidates.length > 0 && (
              <Button onClick={add} disabled={!selected}>
                Add to team
              </Button>
            )}
          </>
        }
      >
        {candidates.length === 0 ? (
          <div className="space-y-3 text-sm text-fg-muted">
            <p>
              {allEmployees.filter((e) => e.active !== false && e.id !== 'hmd-support').length <= teamMembers.length
                ? 'Everyone in your office is already on this project.'
                : 'There is no one else to add.'}{' '}
              People join a project from the office's people list, so first add them to your office on the <strong className="text-fg">Team</strong> page.
            </p>
            {currentUser?.role === 'admin' ? (
              <Button
                onClick={() => {
                  setAddOpen(false);
                  navigate({ view: 'team' });
                }}
              >
                <UserPlus size={15} /> Add people to the office
              </Button>
            ) : (
              <p>Ask an administrator to add them.</p>
            )}
          </div>
        ) : (
        <Field label="Person">
          <select data-autofocus className={selectClass} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose someone…</option>
            {candidates.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} · {emp.title}
              </option>
            ))}
          </select>
        </Field>
        )}
      </Modal>
    </div>
  );
};
