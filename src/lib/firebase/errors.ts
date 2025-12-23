'use client';

// Defines the context for a Firestore security rule violation.
export type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  requestResourceData?: any;
};

// Defines the context for a Firebase Storage security rule violation.
export type StorageSecurityRuleContext = {
  path: string;
  operation: 'read' | 'write' | 'delete';
};

// A custom error class to provide detailed context about Firestore permission errors.
export class FirestorePermissionError extends Error {
  public context: SecurityRuleContext;

  constructor(context: SecurityRuleContext) {
    const message = `FirestoreError: Missing or insufficient permissions: The following request was denied by Firestore Security Rules:
${JSON.stringify(context, null, 2)}`;
    super(message);
    this.name = 'FirestorePermissionError';
    this.context = context;
  }
}

// A custom error class to provide detailed context about Storage permission errors.
export class StoragePermissionError extends Error {
    public context: StorageSecurityRuleContext;
    
    constructor(context: StorageSecurityRuleContext) {
        const message = `StorageError: Missing or insufficient permissions: The following request was denied by Firebase Storage Security Rules:
${JSON.stringify(context, null, 2)}`;
        super(message);
        this.name = 'StoragePermissionError';
        this.context = context;
    }
}
