<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { supabase } from '@/lib/supabase'

type Category = { id: string; title: string }
type Rate = { id: string; category_id: string; effective_from: string; royalty_percent: number }
type Product = { offer_id: string; product_title: string; category_id: string | null }

const router = useRouter()
const categories = ref<Category[]>([])
const rates = ref<Rate[]>([])
const products = ref<Product[]>([])
const effectiveFrom = ref(new Date().toISOString().slice(0, 10))
const rateDrafts = ref<Record<string, string>>({})
const newCategory = ref('')
const productSearch = ref('')
const isGuest = ref(false)
const notice = ref('')

const latestRateByCategory = computed(() => {
  const byCategory = new Map<string, Rate>()
  for (const rate of rates.value) {
    const current = byCategory.get(rate.category_id)
    if (!current || rate.effective_from > current.effective_from)
      byCategory.set(rate.category_id, rate)
  }
  return byCategory
})

const unmappedProducts = computed(() => products.value.filter((product) => !product.category_id))
const mappedProducts = computed(() => {
  const search = productSearch.value.trim().toLowerCase()
  return products.value.filter(
    (product) =>
      product.category_id &&
      (!search || `${product.product_title} ${product.offer_id}`.toLowerCase().includes(search)),
  )
})

async function load() {
  if (!supabase) return
  const { data: session } = await supabase.auth.getSession()
  isGuest.value = session.session?.user.email?.toLowerCase() === 'guest@gmail.com'
  const [categoryResult, rateResult, productResult] = await Promise.all([
    supabase.from('crm_epicentr_royalty_categories').select('id, title').order('title'),
    supabase
      .from('crm_epicentr_royalty_rates')
      .select('id, category_id, effective_from, royalty_percent'),
    supabase
      .from('crm_epicentr_product_categories')
      .select('offer_id, product_title, category_id')
      .order('product_title'),
  ])
  categories.value = categoryResult.data ?? []
  rates.value = rateResult.data ?? []
  products.value = productResult.data ?? []
  for (const category of categories.value) {
    rateDrafts.value[category.id] = String(
      latestRateByCategory.value.get(category.id)?.royalty_percent ?? '',
    )
  }
}

async function saveRate(category: Category) {
  if (!supabase || isGuest.value) return
  const percent = Number(rateDrafts.value[category.id]?.replace(',', '.'))
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return
  const { error } = await supabase
    .from('crm_epicentr_royalty_rates')
    .upsert(
      { category_id: category.id, effective_from: effectiveFrom.value, royalty_percent: percent },
      { onConflict: 'category_id,effective_from' },
    )
  if (error) {
    notice.value = `Не удалось сохранить: ${error.message}`
    return
  }
  notice.value = `Ставка «${category.title}» сохранена с ${effectiveFrom.value}.`
  await load()
}

async function addCategory() {
  if (!supabase || isGuest.value || !newCategory.value.trim()) return
  const { error } = await supabase
    .from('crm_epicentr_royalty_categories')
    .insert({ title: newCategory.value.trim() })
  if (error) {
    notice.value = `Не удалось добавить категорию: ${error.message}`
    return
  }
  newCategory.value = ''
  await load()
}

async function assignProductCategory(product: Product, event: Event) {
  if (!supabase || isGuest.value) return
  const categoryId = (event.target as HTMLSelectElement).value || null
  const { error } = await supabase
    .from('crm_epicentr_product_categories')
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq('offer_id', product.offer_id)
  if (error) {
    notice.value = `Не удалось сопоставить товар: ${error.message}`
    return
  }
  product.category_id = categoryId
  notice.value = categoryId ? 'Категория товара сохранена.' : 'Сопоставление товара удалено.'
}

onMounted(load)
</script>

<template>
  <main class="min-h-screen bg-slate-50 p-5 text-slate-900 sm:p-8">
    <div class="mx-auto max-w-5xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Роялти Эпицентр</h1>
          <p class="mt-1 text-sm text-slate-500">Ставка применяется к заказам по дате заказа.</p>
        </div>
        <button
          class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold"
          @click="router.back()"
        >
          ← К ценам
        </button>
      </div>

      <p v-if="notice" class="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {{ notice }}
      </p>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold">Категории и ставки</h2>
            <p class="text-sm text-slate-500">Новая дата не изменит уже сохранённые заказы.</p>
          </div>
          <label class="text-sm font-medium text-slate-600"
            >Дата начала<input
              v-model="effectiveFrom"
              class="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
              type="date"
          /></label>
        </div>
        <div class="mt-4 divide-y divide-slate-200">
          <div
            v-for="category in categories"
            :key="category.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <strong>{{ category.title }}</strong>
            <label class="flex items-center gap-2 text-sm text-slate-600"
              >Роялти, %<input
                v-model="rateDrafts[category.id]"
                :readonly="isGuest"
                class="w-20 rounded-lg border border-orange-200 px-2 py-1.5 font-semibold text-slate-900"
                inputmode="decimal"
                @keydown.enter.prevent="saveRate(category)"
            /></label>
          </div>
        </div>
        <div v-if="!isGuest" class="mt-4 flex gap-2 border-t border-slate-200 pt-4">
          <input
            v-model="newCategory"
            class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Новая категория"
            @keydown.enter.prevent="addCategory"
          /><button
            class="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white"
            @click="addCategory"
          >
            Добавить
          </button>
        </div>
      </section>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-bold">Новые товары без категории</h2>
        <p class="mt-1 text-sm text-slate-500">
          Появляются автоматически после синхронизации заказа Эпицентра.
        </p>
        <p v-if="!unmappedProducts.length" class="mt-4 text-sm text-emerald-700">
          Все загруженные товары уже сопоставлены.
        </p>
        <div v-else class="mt-4 divide-y divide-slate-200">
          <div
            v-for="product in unmappedProducts"
            :key="product.offer_id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <strong>{{ product.product_title }}</strong
              ><span class="ml-2 text-xs text-slate-500">{{ product.offer_id }}</span>
            </div>
            <select
              :value="product.category_id ?? ''"
              :disabled="isGuest"
              class="rounded-lg border border-slate-300 px-3 py-2"
              @change="assignProductCategory(product, $event)"
            >
              <option value="">Выбрать категорию</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ category.title }}
              </option>
            </select>
          </div>
        </div>
      </section>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold">Уже сопоставленные товары</h2>
            <p class="mt-1 text-sm text-slate-500">
              Здесь можно исправить ошибочно выбранную категорию.
            </p>
          </div>
          <label class="text-sm text-slate-600"
            >Поиск<input
              v-model="productSearch"
              class="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Название или offerId"
          /></label>
        </div>
        <p v-if="!mappedProducts.length" class="mt-4 text-sm text-slate-500">
          Сопоставленных товаров пока нет.
        </p>
        <div v-else class="mt-4 divide-y divide-slate-200">
          <div
            v-for="product in mappedProducts"
            :key="product.offer_id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <strong>{{ product.product_title }}</strong
              ><span class="ml-2 text-xs text-slate-500">{{ product.offer_id }}</span>
            </div>
            <select
              :value="product.category_id ?? ''"
              :disabled="isGuest"
              class="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2"
              @change="assignProductCategory(product, $event)"
            >
              <option value="">Без категории</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ category.title }}
              </option>
            </select>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
