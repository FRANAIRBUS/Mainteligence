import { EventEmitter } from 'events';
import type { FirestorePermissionError } from './errors';

// Type-safe event emitter for permission errors.
interface PermissionErrorEvents {
  'permission-error': (error: FirestorePermissionError) => void;
}

declare interface PermissionEventEmitter {
  on<U extends keyof PermissionErrorEvents>(event: U, listener: PermissionErrorEvents[U]): this;
  emit<U extends keyof PermissionErrorEvents>(event: U, ...args: Parameters<PermissionErrorEvents[U]>): boolean;
}

class PermissionEventEmitter extends EventEmitter {}

export const errorEmitter = new PermissionEventEmitter();
