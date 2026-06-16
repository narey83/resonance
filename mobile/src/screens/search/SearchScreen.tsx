import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../../context/ThemeContext';
import { makeScreenOptions } from '../../theme';
import SearchHomeScreen from './SearchHomeScreen';
import SearchResultsScreen from './SearchResultsScreen';
import BrowseFolderScreen from './BrowseFolderScreen';

export type SearchStackParamList = {
  SearchHome:    undefined;
  SearchResults: { searchId: string; searchText: string };
  BrowseFolder:  { username: string; directory: string };
};

const Stack = createNativeStackNavigator<SearchStackParamList>();

export default function SearchScreen() {
  const { colors } = useTheme();
  const navOpts = makeScreenOptions(colors);
  return (
    <Stack.Navigator screenOptions={navOpts}>
      <Stack.Screen
        name="SearchHome"
        component={SearchHomeScreen}
        options={{ title: 'Search' }}
      />
      <Stack.Screen
        name="SearchResults"
        component={SearchResultsScreen}
        options={{ title: 'Results' }}
      />
      <Stack.Screen
        name="BrowseFolder"
        component={BrowseFolderScreen}
        options={{ title: 'Folder' }}
      />
    </Stack.Navigator>
  );
}
