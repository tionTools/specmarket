import { createRouter, createWebHistory } from 'vue-router'
// import DefaultLayout from '@/layouts/DefaultLayout.vue'
import MainLayout from '@/layouts/MainLayout.vue'

const loadPricesView = () => import('@/pages/PricesView.vue')
const loadReconciliationView = () => import('@/pages/ReconciliationView.vue')
const loadBankStatementView = () => import('@/pages/BankStatementView.vue')

export function preloadPriorityRoutes() {
  void Promise.allSettled([loadPricesView(), loadReconciliationView(), loadBankStatementView()])
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, from, savedPosition) {
    // The order page scrolls after restoring the card and clearing the return query.
    if (to.path === '/' && (to.query.returnOrder || (from.path === '/' && from.query.returnOrder)))
      return false
    if (to.hash === '#banking') return { top: 0 }
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 16 }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', component: () => import('@/pages/HomeView.vue') },
        { path: 'settings', component: () => import('@/pages/SettingsView.vue') },
        { path: 'prices', component: loadPricesView },
        { path: 'epicentr-royalty', component: () => import('@/pages/EpicentrRoyaltyView.vue') },
        { path: 'currency-rates', component: () => import('@/pages/CurrencyRatesView.vue') },
        { path: 'reconciliation', component: loadReconciliationView },
        { path: 'banking/:bank', component: loadBankStatementView },
      ],
    },
  ],
})

export default router
