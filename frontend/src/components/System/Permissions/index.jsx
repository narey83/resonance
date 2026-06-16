/* eslint-disable canonical/filename-match-exported */
import * as permissionsLibrary from '../../../lib/permissions';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Input,
  Label,
  Modal,
  Popup,
  Table,
} from 'semantic-ui-react';

const ROLE_DISPLAY_NAMES = {
  Administrator: 'Admin',
  ReadWrite: 'User',
};

const AddRoleModal = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Role name is required');
      return;
    }

    setLoading(true);
    try {
      const role = await permissionsLibrary.createRole(name.trim());
      onAdd(role);
      setOpen(false);
      reset();
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to create role');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      closeIcon
      onClose={() => {
        setOpen(false);
        reset();
      }}
      onOpen={() => setOpen(true)}
      open={open}
      size="mini"
      trigger={
        <Button
          primary
          size="small"
        >
          <Icon name="plus" />
          Add Role
        </Button>
      }
    >
      <Modal.Header>Add Role</Modal.Header>
      <Modal.Content>
        <Form>
          <Form.Field>
            <Input
              autoFocus
              onChange={(_, { value }) => setName(value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Role name"
              value={name}
            />
          </Form.Field>
          {error && (
            <div style={{ color: 'var(--danger, #db2828)', marginTop: 8 }}>
              {error}
            </div>
          )}
        </Form>
      </Modal.Content>
      <Modal.Actions>
        <Button
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </Button>
        <Button
          loading={loading}
          onClick={handleSubmit}
          primary
        >
          Create
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

const PermissionsMatrix = () => {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await permissionsLibrary.getMatrix();
      setMatrix(data);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isAllowed = (roleName, featureKey) => {
    if (!matrix) return false;
    const entry = matrix.permissions.find(
      (p) => p.roleName === roleName && p.featureKey === featureKey,
    );
    return entry?.allowed ?? false;
  };

  const handleToggle = async (roleName, featureKey, currentValue) => {
    const key = `${roleName}:${featureKey}`;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await permissionsLibrary.setPermission(
        roleName,
        featureKey,
        !currentValue,
      );
      setMatrix((previous) => {
        const perms = previous.permissions.filter(
          (p) => !(p.roleName === roleName && p.featureKey === featureKey),
        );
        return {
          ...previous,
          permissions: [
            ...perms,
            { roleName, featureKey, allowed: !currentValue },
          ],
        };
      });
    } catch (error_) {
      alert(error_.response?.data ?? 'Failed to update permission');
    } finally {
      setSaving((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
    }
  };

  const handleAddRole = (role) => {
    setMatrix((previous) => ({
      ...previous,
      roles: [...previous.roles, role],
      permissions: [
        ...previous.permissions,
        ...previous.features.map((f) => ({
          roleName: role.name,
          featureKey: f.key,
          allowed: false,
        })),
      ],
    }));
  };

  const handleDeleteRole = async (roleName) => {
    if (!window.confirm(`Delete role '${roleName}'? This cannot be undone.`))
      return;
    try {
      await permissionsLibrary.deleteRole(roleName);
      setMatrix((previous) => ({
        ...previous,
        roles: previous.roles.filter((r) => r.name !== roleName),
        permissions: previous.permissions.filter(
          (p) => p.roleName !== roleName,
        ),
      }));
    } catch (error_) {
      alert(error_.response?.data ?? 'Failed to delete role');
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (error)
    return (
      <div style={{ color: 'var(--danger, #db2828)', padding: 16 }}>
        {error}
      </div>
    );
  if (!matrix) return null;

  const { features, roles } = matrix;

  return (
    <div style={{ padding: '0 0 24px' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Header
          as="h4"
          style={{ margin: 0 }}
        >
          Feature Permissions
        </Header>
        <AddRoleModal onAdd={handleAddRole} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <Table
          basic="very"
          size="small"
          textAlign="center"
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell textAlign="left">Feature</Table.HeaderCell>
              {roles.map((role) => (
                <Table.HeaderCell
                  key={role.name}
                  style={{ minWidth: 90 }}
                >
                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span>{ROLE_DISPLAY_NAMES[role.name] ?? role.name}</span>
                    {role.isBuiltIn ? (
                      <Label
                        color="grey"
                        horizontal
                        size="mini"
                      >
                        built-in
                      </Label>
                    ) : (
                      <Popup
                        content={`Delete role '${role.name}'`}
                        trigger={
                          <Icon
                            color="red"
                            link
                            name="trash alternate outline"
                            onClick={() => handleDeleteRole(role.name)}
                            style={{ fontSize: '0.75em', marginTop: 2 }}
                          />
                        }
                      />
                    )}
                  </div>
                </Table.HeaderCell>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {features.map((feature) => (
              <Table.Row key={feature.key}>
                <Table.Cell textAlign="left">{feature.displayName}</Table.Cell>
                {roles.map((role) => {
                  const isAdmin = role.name === 'Administrator';
                  const allowed = isAllowed(role.name, feature.key);
                  const key = `${role.name}:${feature.key}`;
                  return (
                    <Table.Cell key={role.name}>
                      <Checkbox
                        checked={isAdmin ? true : allowed}
                        disabled={isAdmin || saving[key]}
                        onChange={() =>
                          !isAdmin &&
                          handleToggle(role.name, feature.key, allowed)
                        }
                      />
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.82em',
          marginTop: 12,
        }}
      >
        Changes take effect immediately. Administrator always has full access.
      </div>
    </div>
  );
};

export default PermissionsMatrix;
