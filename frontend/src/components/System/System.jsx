import './System.css';
import { urlBase } from '../../config';
import AppContext from '../AppContext';
import { Switch } from '../Shared';
import Events from './Events';
import Info from './Info';
import Logs from './Logs';
import Options from './Options';
import Permissions from './Permissions';
import UserManagement from './UserManagement';
import React, { useContext } from 'react';
import { Redirect, useHistory, useRouteMatch } from 'react-router-dom';
import { Icon, Menu, Tab } from 'semantic-ui-react';

const System = ({ options = {}, state = {}, theme }) => {
  const {
    params: { tab },
    ...route
  } = useRouteMatch();
  const history = useHistory();
  const { isAdmin } = useContext(AppContext);

  const allPanes = [
    {
      menuItem: (
        <Menu.Item key="info">
          <Switch
            pending={
              ((state?.pendingRestart ?? false) ||
                (state?.pendingReconnect ?? false)) && (
                <Icon
                  color="yellow"
                  name="exclamation circle"
                />
              )
            }
          >
            <Icon name="info circle" />
          </Switch>
          Info
        </Menu.Item>
      ),
      render: () => (
        <Tab.Pane>
          <Info
            state={state}
            theme={theme}
          />
        </Tab.Pane>
      ),
      route: 'info',
    },
    {
      adminOnly: true,
      menuItem: {
        content: 'Options',
        icon: 'options',
        key: 'options',
      },
      render: () => (
        <Tab.Pane className="opts-pane">
          <Options
            options={options}
            state={state}
            theme={theme}
          />
        </Tab.Pane>
      ),
      route: 'options',
    },
    {
      menuItem: {
        content: 'Events',
        icon: 'calendar check',
        key: 'events',
      },
      render: () => (
        <Tab.Pane className="full-height">
          <Events />
        </Tab.Pane>
      ),
      route: 'events',
    },
    {
      menuItem: {
        content: 'Logs',
        icon: 'file outline',
        key: 'logs',
      },
      render: () => (
        <Tab.Pane>
          <Logs />
        </Tab.Pane>
      ),
      route: 'logs',
    },
    {
      adminOnly: true,
      menuItem: {
        content: 'Users',
        icon: 'users',
        key: 'users',
      },
      render: () => (
        <Tab.Pane>
          <UserManagement />
        </Tab.Pane>
      ),
      route: 'users',
    },
    {
      adminOnly: true,
      menuItem: {
        content: 'Permissions',
        icon: 'lock',
        key: 'permissions',
      },
      render: () => (
        <Tab.Pane>
          <Permissions />
        </Tab.Pane>
      ),
      route: 'permissions',
    },
    {
      adminOnly: true,
      menuItem: (
        <Menu.Item key="database">
          <Icon name="database" />
          Database
          <Icon
            name="external alternate"
            style={{ marginLeft: 6, opacity: 0.5, fontSize: '0.75em' }}
          />
        </Menu.Item>
      ),
      popup: true,
      render: () => <Tab.Pane />,
      route: 'database',
    },
  ];

  const panes = allPanes.filter((p) => !p.adminOnly || isAdmin);

  const activeIndex = panes.findIndex((pane) => pane.route === tab);

  const onTabChange = (_event, { activeIndex: newActiveIndex }) => {
    const pane = panes[newActiveIndex];
    if (pane.popup) {
      window.open(
        `${urlBase}/db`,
        'resonance-db',
        'width=1440,height=900,resizable=yes',
      );
      return;
    }

    history.push(pane.route);
  };

  if (tab === undefined) {
    return <Redirect to={`${route.url}/${panes[0].route}`} />;
  }

  if (tab === 'database') {
    window.open(
      `${urlBase}/db`,
      'resonance-db',
      'width=1440,height=900,resizable=yes',
    );
    return <Redirect to={`${route.url}/info`} />;
  }

  // redirect non-admins away from admin-only tabs
  const requestedPane = allPanes.find((p) => p.route === tab);
  if (requestedPane?.adminOnly && !isAdmin) {
    return <Redirect to={`${route.url}/info`} />;
  }

  return (
    <div className="system">
      <Tab
        activeIndex={activeIndex > -1 ? activeIndex : 0}
        onTabChange={onTabChange}
        panes={panes}
      />
    </div>
  );
};

export default System;
