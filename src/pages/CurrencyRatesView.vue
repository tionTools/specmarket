<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useNow } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@lucide/vue'

import {
  currencyRateEntryForDate,
  currencyRateForDate,
  localDateKey,
  type CurrencyRateRow,
} from '@/features/prices/currencyRates'
import { supabase } from '@/lib/supabase'

const router = useRouter()
const rates = ref<CurrencyRateRow[]>([])
const now = useNow({ interval: 60_000 })
const currentRate = computed(() => currencyRateForDate(rates.value, localDateKey(now.value), 0))
const currentEntry = computed(() => currencyRateEntryForDate(rates.value, localDateKey(now.value)))
const newRate = ref('')
const effectiveFrom = ref(localDateKey())
const isGuest = ref(true)
const isSaving = ref(false)
const notice = ref('')
const error = ref('')

function formatRate(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

async function load() {
  if (!supabase) {
    error.value = 'Нет настроек Supabase в опубликованной версии сайта.'
    return
  }
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) {
    await router.replace('/prices')
    return
  }
  isGuest.value = session.session.user.email?.toLowerCase() === 'guest@gmail.com'
  const { data, error: loadError } = await supabase
    .from('crm_currency_rates')
    .select('effective_from, rate')
    .eq('currency', 'USD')
    .order('effective_from', { ascending: false })
  if (loadError) {
    rates.value = []
    error.value = `Не удалось загрузить историю курса: ${loadError.message}`
    return
  }
  rates.value = (data ?? []).map((row) => ({
    effective_from: String(row.effective_from),
    rate: Number(row.rate),
  }))
  error.value = rates.value.length ? '' : 'История курса USD пуста. Добавьте курс.'
}

async function saveRate() {
  if (!supabase || isGuest.value || isSaving.value) return
  const rate = Number(newRate.value.trim().replace(',', '.'))
  if (!effectiveFrom.value || !Number.isFinite(rate) || rate <= 0) {
    error.value = 'Укажите положительный курс и дату начала действия.'
    return
  }

  isSaving.value = true
  error.value = ''
  notice.value = ''
  const { error: saveError } = await supabase.from('crm_currency_rates').upsert(
    {
      currency: 'USD',
      effective_from: effectiveFrom.value,
      rate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'currency,effective_from' },
  )
  if (saveError) {
    isSaving.value = false
    error.value = `Не удалось сохранить курс: ${saveError.message}`
    return
  }

  await load()
  if (currentRate.value > 0) {
    const { error: cacheError } = await supabase
      .from('crm_settings')
      .upsert({ key: 'usd_rate', numeric_value: currentRate.value })
    if (cacheError) {
      notice.value = `Курс сохранён, но совместимый cache не обновлён: ${cacheError.message}`
    } else {
      notice.value = `Курс ${formatRate(rate)} сохранён с ${effectiveFrom.value}.`
    }
  } else {
    notice.value = `Курс ${formatRate(rate)} сохранён с ${effectiveFrom.value}.`
  }
  newRate.value = ''
  isSaving.value = false
}

onMounted(load)
</script>

<template>
  <main class="min-h-screen bg-slate-50 p-5 text-slate-900 sm:p-8">
    <div class="mx-auto max-w-3xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Курс USD</h1>
          <p class="mt-1 text-sm text-slate-500">
            Курс применяется по дате заказа. Уже сохранённая историческая себестоимость не
            пересчитывается.
          </p>
        </div>
        <button
          class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold"
          type="button"
          @click="router.push('/prices')"
        >
          <ArrowLeft class="mr-1 inline size-4" aria-hidden="true" /> К ценам
        </button>
      </div>

      <p v-if="notice" class="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {{ notice }}
      </p>
      <p v-if="error" class="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {{ error }}
      </p>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-slate-500">Текущий курс</p>
            <p class="mt-1 text-3xl font-bold">
              {{ currentRate > 0 ? `${formatRate(currentRate)} ₴` : '—' }}
            </p>
            <p v-if="currentEntry" class="mt-1 text-sm text-slate-500">
              Действует с {{ currentEntry.effective_from }}
            </p>
          </div>
          <div v-if="!isGuest" class="flex flex-wrap items-end gap-3">
            <label class="text-sm font-medium text-slate-600">
              Новый курс
              <input
                v-model="newRate"
                class="mt-1 block w-32 rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="46,00"
                type="text"
                @keydown.enter.prevent="saveRate"
              />
            </label>
            <label class="text-sm font-medium text-slate-600">
              Действует с
              <input
                v-model="effectiveFrom"
                class="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
                type="date"
              />
            </label>
            <button
              class="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              :disabled="isSaving"
              type="button"
              @click="saveRate"
            >
              {{ isSaving ? 'Сохраняем…' : 'Сохранить' }}
            </button>
          </div>
        </div>
      </section>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-bold">История курса</h2>
        <p class="mt-1 text-sm text-slate-500">
          Повторное сохранение той же даты корректирует курс с этой даты.
        </p>
        <p v-if="!rates.length" class="mt-4 text-sm text-slate-500">История пока пуста.</p>
        <div v-else class="mt-4 divide-y divide-slate-200">
          <div
            v-for="rate in rates"
            :key="rate.effective_from"
            class="flex items-center justify-between gap-4 py-3"
          >
            <span class="text-sm text-slate-600">{{ rate.effective_from }}</span>
            <strong>{{ formatRate(Number(rate.rate)) }} ₴</strong>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
