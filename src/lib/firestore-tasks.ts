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
import type {
  MaintenanceTask,
  MaintenanceTaskInput,
} from "@/types/maintenance-task";

const TASKS_COLLECTION = "tasks";

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
  payload: MaintenanceTaskInput
): Promise<string> => {
  if (!payload.createdBy) {
    throw new Error("Missing creator for task creation");
  }

  const docRef = await addDoc(tasksCollection(db), payload);
  return docRef.id;
};

export const upsertTask = async (
  db: Firestore,
  id: string,
  payload: MaintenanceTaskInput
) => {
  const docRef = doc(db, TASKS_COLLECTION, id).withConverter(taskConverter);
  await setDoc(docRef, payload, { merge: true });
  return id;
};

export const updateTask = async (
  db: Firestore,
  id: string,
  updates: Partial<MaintenanceTaskInput>
) => {
  const docRef = doc(db, TASKS_COLLECTION, id);
  await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  return id;
};

export const deleteTask = async (db: Firestore, id: string) => {
  const docRef = doc(db, TASKS_COLLECTION, id);
  await deleteDoc(docRef);
};
