// Compatibility export: Phase 6 moved the rotation state machine into
// src/stores/character-rotation-store.ts so scene generation, UI, and backup
// registry all share one persisted store implementation.
export * from '@/stores/character-rotation-store'
