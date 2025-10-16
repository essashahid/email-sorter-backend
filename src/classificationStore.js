import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

/**
 * Insert or update a classification (good/bad) for an email.
 * Each user-email pair is unique in the DB.
 */
export async function upsertClassification(entry) {
  const normalizedLabel = entry.label?.toLowerCase()
  const normalizedUser =
    typeof entry.user === 'string' ? entry.user.trim() : ''

  if (!normalizedUser) {
    throw new Error('Classification requires a user identifier.')
  }

  if (!['good', 'bad'].includes(normalizedLabel)) {
    throw new Error('Classification label must be either "good" or "bad".')
  }

  const timestamp = new Date().toISOString()

  const payload = {
    user_id: normalizedUser,
    email_id: entry.id,
    label: normalizedLabel,
    subject: entry.subject || '(no subject)',
    from_field: entry.from || 'Unknown sender',
    snippet: entry.snippet || '',
    date: entry.date || null,
    body: entry.body || '',
    label_ids: Array.isArray(entry.labelIds) ? entry.labelIds : [],
    updated_at: timestamp,
    created_at: timestamp,
  }

  const { data, error } = await supabase
    .from('classifications')
    .upsert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to save classification: ${error.message}`)

  return normalizeClassification(data || payload)
}

/**
 * Get all classifications filtered by label and/or user.
 */
export async function getClassifications({ label, user } = {}) {
  let query = supabase.from('classifications').select('*')

  if (user) query = query.eq('user_id', user)
  if (label) query = query.eq('label', label.toLowerCase())

  const { data, error } = await query
  if (error) throw new Error(`Error fetching classifications: ${error.message}`)

  return (data || []).map(normalizeClassification).filter(Boolean)
}

function normalizeClassification(record) {
  if (!record) return null
  return {
    id: record.email_id || record.id || null,
    user: record.user_id || null,
    label: record.label || null,
    subject: record.subject || '(no subject)',
    from: record.from_field || record.from || 'Unknown sender',
    snippet: record.snippet || '',
    body: record.body || '',
    date: record.date || null,
    labelIds: Array.isArray(record.label_ids)
      ? record.label_ids
      : Array.isArray(record.labelIds)
      ? record.labelIds
      : [],
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  }
}
