import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../theme';
import { useAuthStore } from '../store/auth';
import ConnectScreen from '../screens/auth/ConnectScreen';
import LoginScreen   from '../screens/auth/LoginScreen';

export type AuthStackParamList = {
  Connect: undefined;
  Login:   undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthStack() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return (
    <Stack.Navigator
      initialRouteName={serverUrl ? 'Login' : 'Connect'}
      screenOptions={{ ...screenOptions, headerShown: false }}
    >
      <Stack.Screen name="Connect" component={ConnectScreen} />
      <Stack.Screen name="Login"   component={LoginScreen} />
    </Stack.Navigator>
  );
}
