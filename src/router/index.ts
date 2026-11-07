import { createRouter, createWebHistory } from 'vue-router'
// import DefaultLayout from '@/layouts/DefaultLayout.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import HomeView from '@/pages/HomeView.vue'
import SettingsView from '@/pages/SettingsView.vue'
import PricesView from '@/pages/PricesView.vue'
import EpicentrRoyaltyView from '@/pages/EpicentrRoyaltyView.vue'
import CurrencyRatesView from '@/pages/CurrencyRatesView.vue'
import ReconciliationView from '@/pages/ReconciliationView.vue'
import BankStatementView from '@/pages/BankStatementView.vue'

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
        { path: '', component: HomeView },
        { path: 'settings', component: SettingsView },
        { path: 'prices', component: PricesView },
        { path: 'epicentr-royalty', component: EpicentrRoyaltyView },
        { path: 'currency-rates', component: CurrencyRatesView },
        { path: 'reconciliation', component: ReconciliationView },
        { path: 'banking/:bank', component: BankStatementView },
      ],
    },
  ],
})

export default router
