// SPDX-FileCopyrightText: 2026 John Narey
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

export type ChatReturnTab = 'DiscoverTab' | 'LibraryTab' | 'SearchTab' | 'TransfersTab' | 'BrowseTab' | 'MoreTab';

// The floating chat and rooms tabs retain the last visible tab while navigating between them.
export const ChatReturnContext = React.createContext<() => ChatReturnTab>(() => 'DiscoverTab');

export const useChatReturnTab = () => React.useContext(ChatReturnContext);
