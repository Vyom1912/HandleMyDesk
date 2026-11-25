import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Client, Project, ProjectTemplate } from '../../../types';
import { api } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Field, inputClass, selectClass, textareaClass, Button } from '../ui/Field';
import { Avatar } from '../ui/Badges';

const today = () => new Date().toISOString().split('T')[0];
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];

export const CreateProjectModal: React.FC = () => {
  const { isCreateProjectOpen, setIsCreateProjectOpen, openProject, refreshProjects, allEmployees, currentUser, showToast } = useApp();

  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [clientId, setClientId] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState<Project['priority']>('medium');
  const [budget, setBudget] = useState('25000');
  const [startDate, setStartDate] = useState(today());
  const [targetDate, setTargetDate] = useState(inDays(90));
  const [description, setDescription] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCreateProjectOpen) return;
    setSelectedTeam(currentUser ? [currentUser.id] : []);
    api
      .get<ProjectTemplate[]>('/api/templates')
      .then(setTemplates)
      .catch(() => setTemplates([]));
    api
      .get<Client[]>('/api/clients')
      .then((data) => {
        setClients(data);
        setClientId((prev) => prev || data[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, [isCreateProjectOpen, currentUser]);

  const chosen = templates.find((t) => t.id === templateId);
  const builtIn = templates.filter((t) => t.builtIn);
  const custom = templates.filter((t) => !t.builtIn);
  const templateHint = chosen
    ? `${chosen.description ? `${chosen.description} ` : ''}Adds ${chosen.tasks.length} tasks and ${chosen.milestones.length} milestones, dated from the start date and assigned to you.`
    : 'Start empty, or from a template with its usual tasks and milestones.';

  const close = () => {
    setIsCreateProjectOpen(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !clientId) return setError('Enter a project name and choose a client');
    if (targetDate < startDate) return setError('Target date must be after the start date');

    try {
      setSubmitting(true);
      const newProject = await api.post<Project>('/api/projects', {
        name: name.trim(),
        code: code.trim() || undefined,
        clientId,
        category: category.trim() || undefined,
        priority,
        budget: Number(budget) || 0,
        startDate,
        targetDate,
        description: description.trim(),
        teamMemberIds: selectedTeam,
        templateId: templateId || undefined,
      });

      close();
      await refreshProjects();
      openProject(newProject.id, 'overview');
      showToast(`Created ${newProject.name}`, 'success');

      setName('');
      setCode('');
      setCategory('');
      setDescription('');
      setTemplateId('');
      setStartDate(today());
      setTargetDate(inDays(90));
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTeamMember = (empId: string) => {
    if (empId === currentUser?.id) return; // the creator is always the lead
    setSelectedTeam((t) => (t.includes(empId) ? t.filter((id) => id !== empId) : [...t, empId]));
  };

  return (
    <Modal
      open={isCreateProjectOpen}
      onClose={close}
      title="New project"
      description="You'll be the project lead. Links and a full description can be added on the project page."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="create-project-form" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <Field label="Start from" hint={templateHint}>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectClass}>
            <option value="">Blank project</option>
            {builtIn.length > 0 && (
              <optgroup label="Templates">
                {builtIn.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            {custom.length > 0 && (
              <optgroup label="Made by your office">
                {custom.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        <Field label="Project name" required>
          <input data-autofocus type="text" required placeholder="e.g. Mobile checkout portal" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Client" required>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectClass}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project code" hint="Leave blank to generate one">
            <input type="text" placeholder="e.g. MOB-500" value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} font-mono uppercase placeholder:normal-case placeholder:font-sans`} maxLength={20} />
          </Field>
          <Field label="Category">
            <input type="text" placeholder="e.g. Mobile engineering" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Project['priority'])} className={selectClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Budget ($)">
            <input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Target date">
            <input type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Short description">
          <textarea rows={3} placeholder="What is this project about?" value={description} onChange={(e) => setDescription(e.target.value)} className={textareaClass} />
        </Field>

        <fieldset>
          <legend className="block text-[13px] font-medium text-fg-muted mb-1">Team ({selectedTeam.length})</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px max-h-44 overflow-y-auto p-1 border border-line-strong rounded-md">
            {allEmployees.filter((emp) => emp.active !== false).map((emp) => {
              const isSelected = selectedTeam.includes(emp.id);
              const isSelf = emp.id === currentUser?.id;
              return (
                <label key={emp.id} className={`flex items-center gap-2 h-8 px-2 rounded cursor-pointer text-sm ${isSelected ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover'}`}>
                  <input type="checkbox" checked={isSelected} disabled={isSelf} onChange={() => toggleTeamMember(emp.id)} className="accent-[var(--accent)]" />
                  <Avatar src={emp.avatar} name={emp.name} size={18} />
                  <span className="truncate">
                    {emp.name}
                    {isSelf && <span className="text-fg-faint"> · lead</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
};
