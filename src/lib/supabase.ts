import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://rtkhgldaswsclkorlyxx.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PE0btLoBDCEIXlcf5nJZ2g_9PvMhbyb'

export const supabase = url && key ? createClient(url, key) : null
