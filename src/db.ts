import { init } from '@instantdb/react';
import schema from '../instant.schema';

const APP_ID = import.meta.env.VITE_INSTANT_APP_ID as string;

if (!APP_ID) {
  throw new Error('VITE_INSTANT_APP_ID is not set. Copy .env.example to .env and fill in your values.');
}

export const db = init({ appId: APP_ID, schema });
