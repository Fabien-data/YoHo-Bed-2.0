'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, PageHeader, toast } from '@yohobed/ui';
import {
  inviteTeamMember,
  listTeamMembers,
  updateTeamMember,
  type OperationalRole,
} from '@/lib/api';
import { useTenantRole } from '@/lib/queries';

const ROLES: Array<{ value: OperationalRole; label: string }> = [
  { value: 'OWNER_STAFF', label: 'Front desk' },
  { value: 'HOUSEKEEPING_ATTENDANT', label: 'Housekeeping attendant' },
  { value: 'HOUSEKEEPING_SUPERVISOR', label: 'Housekeeping supervisor' },
];

export default function TeamPage() {
  const role = useTenantRole();
  const qc = useQueryClient();
  const team = useQuery({
    queryKey: ['team-members'],
    queryFn: listTeamMembers,
    enabled: role === 'OWNER',
  });
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [memberRole, setMemberRole] = React.useState<OperationalRole>('HOUSEKEEPING_ATTENDANT');
  const invite = useMutation({
    mutationFn: () =>
      inviteTeamMember({ name: name.trim(), email: email.trim(), role: memberRole }),
    onSuccess: () => {
      setName('');
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Invitation sent');
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { role?: OperationalRole; status?: 'active' | 'disabled' };
    }) => updateTeamMember(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Team member updated');
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (role !== 'OWNER')
    return (
      <Card className="p-8 text-sm text-ink-2">Only the property owner can manage the team.</Card>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Team"
        description="Invite front desk and housekeeping staff, then control their operational access."
      />
      <Link
        href="/app/team/roles"
        className="inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold text-brand"
      >
        Manage custom roles and property access
      </Link>
      <Card className="p-4">
        <h2 className="mb-3 font-semibold text-ink">Invite a team member</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_15rem_auto]">
          <Input
            aria-label="Name"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label="Email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            aria-label="Role"
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value as OperationalRole)}
            className="rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            {ROLES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <Button
            disabled={!name.trim() || !email.trim() || invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? 'Sending…' : 'Invite'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          The invitation contains a one hour link for the staff member to create a password.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3 font-semibold text-ink">Team members</div>
        {team.isLoading ? (
          <p className="p-4 text-sm text-ink-3">Loading team…</p>
        ) : (
          <div className="divide-y divide-line">
            {(team.data ?? []).map((member) => (
              <div
                key={member.id}
                className="grid items-center gap-3 px-4 py-3 md:grid-cols-[1fr_1fr_15rem_auto]"
              >
                <div>
                  <div className="font-medium text-ink">{member.name}</div>
                  <div className="text-xs capitalize text-ink-3">{member.status}</div>
                </div>
                <div className="text-sm text-ink-2">{member.email}</div>
                {member.role === 'OWNER' ? (
                  <span className="text-sm font-semibold text-ink">Owner</span>
                ) : (
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    onChange={(e) =>
                      update.mutate({
                        id: member.id,
                        body: { role: e.target.value as OperationalRole },
                      })
                    }
                    className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
                  >
                    {ROLES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                )}
                {member.role === 'OWNER' ? (
                  <span />
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      update.mutate({
                        id: member.id,
                        body: { status: member.status === 'disabled' ? 'active' : 'disabled' },
                      })
                    }
                  >
                    {member.status === 'disabled' ? 'Enable' : 'Disable'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
