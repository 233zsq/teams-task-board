<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Accessible modal shell: labelled dialog, Escape to close, focus kept inside,
 * and focus restored to the opener on close. It never traps the user without
 * an exit — Escape and the overlay both request a close.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    /** 'initial' focuses the first focusable control; a selector can override. */
    initialFocus?: string;
    closeOnOverlay?: boolean;
    panelClass?: string;
  }>(),
  { initialFocus: 'initial', closeOnOverlay: true, panelClass: '' },
);

const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(): HTMLElement[] {
  if (panel.value === null) {
    return [];
  }
  return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }

  if (event.key !== 'Tab') {
    return;
  }

  const items = focusable();
  if (items.length === 0) {
    return;
  }

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  // Disabling an input during an async save can move focus to <body>.
  if (active === null || !panel.value?.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  if (event.shiftKey && (active === first || active === null)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function onOverlayClick(): void {
  if (props.closeOnOverlay) {
    emit('close');
  }
}

onMounted(async () => {
  opener = document.activeElement as HTMLElement | null;
  document.addEventListener('keydown', onKeydown, true);
  await nextTick();
  const items = focusable();
  if (props.initialFocus !== 'initial') {
    const target = panel.value?.querySelector<HTMLElement>(props.initialFocus);
    (target ?? items[0])?.focus();
  } else {
    items[0]?.focus();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true);
  if (opener !== null && document.contains(opener)) {
    opener.focus();
  }
});
</script>

<template>
  <div class="modal-overlay" @click.self="onOverlayClick">
    <div
      ref="panel"
      class="modal-panel"
      :class="props.panelClass"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
    >
      <header class="modal-header">
        <h2 class="modal-title">{{ props.title }}</h2>
        <button type="button" class="icon-btn icon-btn--sm" aria-label="关闭" @click="emit('close')">
          ✕
        </button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="modal-footer">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
