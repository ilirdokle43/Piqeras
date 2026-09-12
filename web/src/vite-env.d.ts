/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * VAPID public key from Firebase → Project settings → Cloud Messaging →
   * Web Push certificates. Optional: without it the app runs normally and
   * simply does not offer web push.
   */
  readonly VITE_FCM_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
