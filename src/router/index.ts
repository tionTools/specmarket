import { createRouter, createWebHistory } from 'vue-router'
// import DefaultLayout from '@/layouts/DefaultLayout.vue'
import MainLayout from '@/layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, _from, savedPosition) {
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
        { path: 'prices', component: () => import('@/pages/PricesView.vue') },
        { path: 'epicentr-royalty', component: () => import('@/pages/EpicentrRoyaltyView.vue') },
        { path: 'currency-rates', component: () => import('@/pages/CurrencyRatesView.vue') },
        { path: 'reconciliation', component: () => import('@/pages/ReconciliationView.vue') },
        { path: 'banking/:bank', component: () => import('@/pages/BankStatementView.vue') },
      ],
    },
  ],
})

export default router
