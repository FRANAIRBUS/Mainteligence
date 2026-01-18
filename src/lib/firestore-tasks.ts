import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  Timestamp,
  type DocumentData,
  type Firestore,
  type FirestoreDataConverter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  limit,
} from "firebase/firestore";
import type { Auth } from "firebase/auth";
import type { MaintenanceTask, MaintenanceTaskInput } from "@/types/maintenance-task";
import type { User, Department } from "@/lib/firebase/models";

type MaintenanceTaskWrite = MaintenanceTaskInput & {
  assignmentEmailSource?: "client" | "server";
};

const TASKS_COLLECTION = "tasks";

const ensureAuthenticatedUser = async (auth: Auth) => {
  await auth.authStateReady?.();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Usuario no autenticado");
  }

  return user;
};

const taskConverter: FirestoreDataConverter<MaintenanceTask> = {
  toFirestore(task: MaintenanceTaskInput): DocumentData {
    if (!task.organizationId) {
      throw new Error("Critical: Missing organizationId in transaction");
    }

    return {
      ...task,
      organizationId: task.organizationId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  },
  fromFirestore(snapshot, options): MaintenanceTask {
    const data = snapshot.data(options) as MaintenanceTask;
    return {
      ...data,
      id: snapshot.id,
    };
  },
};

const tasksCollection = (db: Firestore, organizationId: string) =>
  collection(db, `organizations/${organizationId}/${TASKS_COLLECTION}`).withConverter(taskConverter);

export const subscribeToTasks = (
  db: Firestore,
  organizationId: string,
  onData: (tasks: MaintenanceTask[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [orderBy("dueDate", "asc")],
  options?: { pageSize?: number; cursor?: QueryDocumentSnapshot<MaintenanceTask> }
): Unsubscribe => {
  const pageSize = options?.pageSize ?? 50;
  const cursorConstraints = options?.cursor ? [startAfter(options.cursor)] : [];
  const q = query(
    tasksCollection(db, organizationId),
    ...constraints,
    ...cursorConstraints,
    limit(pageSize)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const tasks = snapshot.docs.map((docSnap) => docSnap.data());
      onData(tasks);
    },
    (error) => {
      console.error("Error al suscribirse a tareas:", error);
      onError?.(error);
    }
  );
};

export const getTask = async (db: Firestore, organizationId: string, id: string) => {
  const docRef = doc(db, `organizations/${organizationId}/${TASKS_COLLECTION}`, id).withConverter(
    taskConverter
  );
  const snapshot = await getDoc(docRef);
  return snapshot.exists() ? snapshot.data() : null;
};

export const createTask = async (
  db: Firestore,
  auth: Auth,
  payload: MaintenanceTaskWrite,
  options?: { users: User[]; departments: Department[] }
): Promise<string> => {
  if (!payload.organizationId) {
    throw new Error("Critical: Missing organizationId in transaction");
  }

  const user = await ensureAuthenticatedUser(auth);

  const docRef = await addDoc(tasksCollection(db, payload.organizationId), {
    ...payload,
    createdBy: user.uid,
    status: payload.status || "pendiente",
    priority: payload.priority || "media",
  });

  return docRef.id;
};

export const upsertTask = async (
  db: Firestore,
  auth: Auth,
  organizationId: string,
  id: string,
  payload: MaintenanceTaskInput
) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, `organizations/${organizationId}/${TASKS_COLLECTION}`, id).withConverter(
    taskConverter
  );
  await setDoc(docRef, payload, { merge: true });
  return id;
};

export const updateTask = async (
  db: Firestore,
  auth: Auth,
  organizationId: string,
  id: string,
  updates: Partial<MaintenanceTaskWrite>,
  options?: { users: User[]; departments: Department[] }
) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, `organizations/${organizationId}/${TASKS_COLLECTION}`, id);
  await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });

  return id;
};

export const addTaskReport = async (
  db: Firestore,
  auth: Auth,
  organizationId: string,
  id: string,
  report: { description: string; createdBy?: string }
) => {
  const user = await ensureAuthenticatedUser(auth);
  const docRef = doc(db, `organizations/${organizationId}/${TASKS_COLLECTION}`, id);

  const reportEntry = {
    description: report.description,
    createdAt: Timestamp.now(),
    createdBy: report.createdBy || user.uid,
  };

  await updateDoc(docRef, {
    reports: arrayUnion(reportEntry),
    updatedAt: serverTimestamp(),
  });
};

export const deleteTask = async (
  db: Firestore,
  auth: Auth,
  organizationId: string,
  id: string
) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, `organizations/${organizationId}/${TASKS_COLLECTION}`, id);
  await deleteDoc(docRef);
};
