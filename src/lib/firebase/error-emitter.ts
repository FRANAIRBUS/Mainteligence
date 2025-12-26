import { EventEmitter } from 'events';
import type { FirestorePermissionError, StoragePermissionError } from './errors';

type PermissionError = FirestorePermissionError | StoragePermissionError;

// Type-safe event emitter for permission errors.
interface PermissionErrorEvents {
  'permission-error': (error: PermissionError) => void;
}

declare interface PermissionEventEmitter {
  on<U extends keyof PermissionErrorEvents>(event: U, listener: PermissionErrorEvents[U]): this;
  emit<U extends keyof PermissionErrorEvents>(event: U, ...args: Parameters<PermissionErrorEvents[U]>): boolean;
}

class PermissionEventEmitter extends EventEmitter {}

export const errorEmitter = new PermissionEventEmitter();
