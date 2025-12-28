import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
  type FirestoreDataConverter,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import type { Auth } from "firebase/auth";
import type {
  MaintenanceTask,
  MaintenanceTaskInput,
} from "@/types/maintenance-task";
import type { User, Department } from "@/lib/firebase/models";
import { sendAssignmentEmail } from "@/lib/assignment-email";

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
    return {
      ...task,
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

const tasksCollection = (db: Firestore) =>
  collection(db, TASKS_COLLECTION).withConverter(taskConverter);

export const subscribeToTasks = (
  db: Firestore,
  onData: (tasks: MaintenanceTask[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [orderBy("dueDate", "asc")]
): Unsubscribe => {
  const q = query(tasksCollection(db), ...constraints);
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

export const getTask = async (db: Firestore, id: string) => {
  const docRef = doc(db, TASKS_COLLECTION, id).withConverter(taskConverter);
  const snapshot = await getDoc(docRef);
  return snapshot.exists() ? snapshot.data() : null;
};

export const createTask = async (
  db: Firestore,
  auth: Auth,
  payload: MaintenanceTaskInput,
  options?: { users: User[]; departments: Department[] }
): Promise<string> => {
  const user = await ensureAuthenticatedUser(auth);

  const docRef = await addDoc(tasksCollection(db), {
    ...payload,
    createdBy: user.uid,
    status: payload.status || "pendiente",
    priority: payload.priority || "media",
  });

  if (options && (payload.assignedTo || payload.departmentId)) {
    try {
      await sendAssignmentEmail({
        users: options.users,
        departments: options.departments,
        assignedTo: payload.assignedTo,
        departmentId: payload.departmentId,
        title: payload.title,
        link: typeof window !== 'undefined' ? `${window.location.origin}/tasks/${docRef.id}` : '',
        type: "tarea",
        identifier: payload.identifier
      });
    } catch (e) {
      console.error("Error intentando enviar email:", e);
    }
  }

  return docRef.id;
};

export const upsertTask = async (
  db: Firestore,
  auth: Auth,
  id: string,
  payload: MaintenanceTaskInput
) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, TASKS_COLLECTION, id).withConverter(taskConverter);
  await setDoc(docRef, payload, { merge: true });
  return id;
};

export const updateTask = async (
  db: Firestore,
  auth: Auth,
  id: string,
  updates: Partial<MaintenanceTaskInput>,
  options?: { users: User[]; departments: Department[] }
) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, TASKS_COLLECTION, id);
  await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });

  if (options && (updates.assignedTo || updates.departmentId)) {
    try {
      const title = updates.title || "Tarea Actualizada"; 
      
      await sendAssignmentEmail({
        users: options.users,
        departments: options.departments,
        assignedTo: updates.assignedTo,
        departmentId: updates.departmentId,
        title: title,
        link: typeof window !== 'undefined' ? `${window.location.origin}/tasks/${id}` : '',
        type: "tarea",
        identifier: updates.identifier
      });
    } catch (e) {
       console.error("Error intentando enviar email en update:", e);
    }
  }

  return id;
};

export const deleteTask = async (db: Firestore, auth: Auth, id: string) => {
  await ensureAuthenticatedUser(auth);
  const docRef = doc(db, TASKS_COLLECTION, id);
  await deleteDoc(docRef);
};
