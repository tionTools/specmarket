<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, CircleDollarSign, Save } from '@lucide/vue'
import { useRouter } from 'vue-router'

import {
  applyAppearance,
  appearanceStorageKey,
  parseAppearance,
  type Appearance,
} from '@/lib/appearance'
import { supabase } from '@/lib/supabase'

const defaultLabelRecipientEmail = 'prozaxist.ocean@gmail.com'
const newOrderNotificationsStorageKey = 'specmarket-crm-new-order-notifications'
const router = useRouter()
const user = ref<User | null>(null)
const labelRecipientEmail = ref(defaultLabelRecipientEmail)
const isSavingEmail = ref(false)
const emailMessage = ref('')
const soundEnabled = ref(
  window.localStorage.getItem(newOrderNotificationsStorageKey) !== 'false',
)
const appearance = ref<Appearance>(
  parseAppearance(window.localStorage.getItem(appearanceStorageKey)),
)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const isGuest = computed(() => user.value?.email?.toLowerCase() === 'guest@gmail.com')

function handleSystemTheme() {
  if (appearance.value === 'system') applyAppearance(appearance.value)
}

watch(soundEnabled, (value) => {
  window.localStorage.setItem(newOrderNotificationsStorageKey, String(value))
})

watch(
  appearance,
  (value) => {
    window.localStorage.setItem(appearanceStorageKey, value)
    applyAppearance(value)
  },
  { immediate: true },
)

async function saveLabelRecipientEmail() {
  if (!supabase || !user.value || isGuest.value || isSavingEmail.value) return
  const value = labelRecipientEmail.value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    emailMessage.value = 'Введите корректный email.'
    return
  }
  isSavingEmail.value = true
  emailMessage.value = ''
  const { data, error } = await supabase.auth.updateUser({
    data: { labelRecipientEmail: value },
  })
  isSavingEmail.value = false
  if (error) {
    emailMessage.value = `Не удалось сохранить email: ${error.message}`
    return
  }
  user.value = data.user
  labelRecipientEmail.value = value
  emailMessage.value = 'Email сохранён для CRM.'
}

onMounted(async () => {
  systemTheme.addEventListener('change', handleSystemTheme)
  if (!supabase) return
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    await router.replace('/')
    return
  }
  user.value = session.user
  labelRecipientEmail.value =
    String(session.user.user_metadata?.labelRecipientEmail ?? '').trim() ||
    defaultLabelRecipientEmail
})

onScopeDispose(() => systemTheme.removeEventListener('change', handleSystemTheme))
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <main class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold">Настройки</h1>
        </div>
        <RouterLink
          class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-800"
          to="/"
        >
          <ArrowLeft class="size-4" aria-hidden="true" /> Заказы
        </RouterLink>
      </div>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-semibold">Общие настройки CRM</h2>
        <label class="mt-4 block text-sm font-medium text-slate-600">
          Email для бирок
          <div class="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              v-model="labelRecipientEmail"
              class="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
              type="email"
              :disabled="isGuest || isSavingEmail"
            />
            <button
              v-if="!isGuest"
              class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              type="button"
              :disabled="isSavingEmail"
              @click="saveLabelRecipientEmail"
            >
              <Save class="size-4" aria-hidden="true" />
              {{ isSavingEmail ? 'Сохраняем…' : 'Сохранить' }}
            </button>
          </div>
        </label>
        <p v-if="emailMessage" class="mt-2 text-sm text-slate-600">{{ emailMessage }}</p>
        <p v-if="isGuest" class="mt-2 text-sm text-sky-700">
          Гостевой режим: общие настройки доступны только для просмотра.
        </p>
      </section>

      <section class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-semibold">Настройки этого устройства</h2>
        <label class="mt-4 flex items-center justify-between gap-4 text-sm font-medium">
          <span>Звуковые уведомления</span>
          <input v-model="soundEnabled" class="size-5 accent-emerald-700" type="checkbox" />
        </label>
        <label class="mt-4 flex items-center justify-between gap-4 text-sm font-medium">
          <span>Тема</span>
          <select
            v-model="appearance"
            class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
          >
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </label>
      </section>

      <section class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-semibold">Цены и курсы</h2>
        <div class="mt-4 flex flex-wrap gap-2">
          <RouterLink
            class="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-800 hover:bg-emerald-100"
            to="/prices"
          >
            <CircleDollarSign class="size-4" aria-hidden="true" /> Цены и себестоимость
          </RouterLink>
          <RouterLink
            class="rounded-xl border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            to="/currency-rates"
          >
            Курсы валют
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>
