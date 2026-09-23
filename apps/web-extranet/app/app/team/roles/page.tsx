'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, PageHeader, toast } from '@yohobed/ui';
import {
  assignHotelRole,
  createHotelRole,
  listHotelRoles,
  listHotelRoleTemplates,
  listProperties,
  listTeamMembers,
  revokeHotelRole,
  updateHotelRole,
  type HotelPermission,
  type HotelRoleInput,
} from '@/lib/api';
import { useTenantRole } from '@/lib/queries';

const ACTIONS: Array<[HotelPermission, string]> = [
  ['reservation_read', 'View reservations'],
  ['reservation_change', 'Change reservations'],
  ['check_in_out', 'Check guests in and out'],
  ['room_assignment', 'Assign and move rooms'],
  ['financial_read', 'View prices and financial details'],
  ['price_change', 'Change prices'],
  ['minimum_exception', 'Override a minimum rate'],
  ['housekeeping', 'Manage housekeeping'],
  ['setup', 'Edit property setup'],
];

export default function HotelRolesPage() {
  const owner = useTenantRole() === 'OWNER';
  const client = useQueryClient();
  const roles = useQuery({ queryKey: ['hotel-roles'], queryFn: listHotelRoles, enabled: owner });
  const templates = useQuery({
    queryKey: ['hotel-role-templates'],
    queryFn: listHotelRoleTemplates,
    enabled: owner,
  });
  const properties = useQuery({
    queryKey: ['properties'],
    queryFn: listProperties,
    enabled: owner,
  });
  const team = useQuery({ queryKey: ['team-members'], queryFn: listTeamMembers, enabled: owner });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<HotelRoleInput>({
    name: '',
    permissions: [],
    propertyIds: [],
  });
  const [pendingMember, setPendingMember] = React.useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['hotel-roles'] });
  const save = useMutation({
    mutationFn: () => (editingId ? updateHotelRole(editingId, form) : createHotelRole(form)),
    onSuccess: () => {
      refresh();
      toast.success('Role saved');
      setEditingId(null);
      setForm({ name: '', permissions: [], propertyIds: [] });
    },
    onError: (error) => toast.error(error.message),
  });
  const membership = useMutation({
    mutationFn: ({
      roleId,
      userId,
      revoke,
    }: {
      roleId: string;
      userId: string;
      revoke: boolean;
    }) => (revoke ? revokeHotelRole(roleId, userId) : assignHotelRole(roleId, userId)),
    onSuccess: () => {
      refresh();
      setPendingMember('');
      toast.success('Team access updated');
    },
    onError: (error) => toast.error(error.message),
  });
  if (!owner)
    return <Card className="p-8 text-sm text-ink-2">Only the hotel owner can manage roles.</Card>;
  const assignedUserIds = new Set(
    (roles.data ?? []).flatMap((role) => role.members.map((member) => member.userId)),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Hotel roles"
        description="Choose the actions each role can perform and grant properties explicitly. Changes take effect on the next request."
      />
      <Link href="/app/team" className="text-sm text-brand underline">
        Back to team
      </Link>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">{editingId ? 'Edit role' : 'Create a role'}</h2>
        {!editingId && (
          <label className="block text-sm text-ink-2">
            Start from a template
            <select
              aria-label="Role template"
              className="mt-1 block w-full rounded-lg border border-line bg-surface p-2 text-ink"
              defaultValue=""
              onChange={(event) => {
                const template = templates.data?.find((item) => item.name === event.target.value);
                if (template)
                  setForm((old) => ({
                    ...old,
                    name: template.name,
                    permissions: [...template.permissions],
                  }));
              }}
            >
              <option value="">Choose a template or create your own</option>
              {templates.data?.map((template) => (
                <option key={template.name}>{template.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm text-ink-2">
          Role name
          <Input
            className="mt-1"
            value={form.name}
            onChange={(event) => setForm((old) => ({ ...old, name: event.target.value }))}
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Allowed actions</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIONS.map(([key, label]) => (
              <label
                key={key}
                className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.permissions.includes(key)}
                  onChange={(event) =>
                    setForm((old) => ({
                      ...old,
                      permissions: event.target.checked
                        ? [...old.permissions, key]
                        : old.permissions.filter((item) => item !== key),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Granted properties</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.data?.map((property) => (
              <label
                key={property.id}
                className="flex gap-2 rounded-lg border border-line p-3 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  checked={form.propertyIds.includes(property.id)}
                  onChange={(event) =>
                    setForm((old) => ({
                      ...old,
                      propertyIds: event.target.checked
                        ? [...old.propertyIds, property.id]
                        : old.propertyIds.filter((item) => item !== property.id),
                    }))
                  }
                />
                {property.name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-3">
            A role with no granted property cannot access property data.
          </p>
        </fieldset>
        <div className="flex gap-2">
          <Button
            disabled={save.isPending || !form.name.trim() || !form.permissions.length}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save role'}
          </Button>
          {editingId && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditingId(null);
                setForm({ name: '', permissions: [], propertyIds: [] });
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.id} className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">{role.name}</h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingId(role.id);
                  setForm({
                    name: role.name,
                    permissions: [...role.permissions],
                    propertyIds: [...role.propertyIds],
                  });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Edit
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              {role.permissions
                .map((item) => ACTIONS.find(([key]) => key === item)?.[1] ?? item)
                .join(' · ')}
            </p>
            <p className="text-xs text-ink-3">
              Properties:{' '}
              {role.propertyIds
                .map((id) => properties.data?.find((property) => property.id === id)?.name ?? id)
                .join(', ') || 'None'}
            </p>
            <div className="border-t border-line pt-3">
              <h3 className="mb-2 text-sm font-semibold text-ink">Team members</h3>
              {role.members.map((member) => (
                <div
                  key={member.userId}
                  className="mb-2 flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {member.name} <span className="text-ink-3">({member.email})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={membership.isPending}
                    onClick={() =>
                      membership.mutate({ roleId: role.id, userId: member.userId, revoke: true })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <select
                  aria-label={`Assign ${role.name} to team member`}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-2 text-sm text-ink"
                  value={pendingMember}
                  onChange={(event) => setPendingMember(event.target.value)}
                >
                  <option value="">Choose team member</option>
                  {team.data
                    ?.filter((member) => member.role !== 'OWNER' && !assignedUserIds.has(member.id))
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.email}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  disabled={!pendingMember || membership.isPending}
                  onClick={() =>
                    membership.mutate({ roleId: role.id, userId: pendingMember, revoke: false })
                  }
                >
                  Assign
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
