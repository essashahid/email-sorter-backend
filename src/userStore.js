import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

/**
 * Insert or update user record with tokens.
 */
export async function upsertUserRecord({ id, email, name, picture, tokens }) {
  if (!id) throw new Error('User id is required to upsert a user.')

  const timestamp = new Date().toISOString()

  const payload = {
    user_id: id,
    email: email || '',
    name: name || '',
    picture: picture || '',
    tokens: tokens || {},
    updated_at: timestamp,
    created_at: timestamp,
  }

  const { error } = await supabase.from('user_tokens').upsert(payload)
  if (error) throw new Error(`Failed to save user: ${error.message}`)

  return payload
}

/**
 * Save tokens for an existing user.
 */
export async function saveUserTokens(userId, tokens) {
  if (!userId) throw new Error('User id is required to save tokens.')

  const timestamp = new Date().toISOString()
  const { error } = await supabase
    .from('user_tokens')
    .update({ tokens, updated_at: timestamp })
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to update tokens: ${error.message}`)
}

/**
 * Get full user record by ID.
 */
export async function getUserById(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user:', error.message)
    return null
  }

  if (!data) return null

  return {
    id: data.user_id,
    email: data.email || '',
    name: data.name || '',
    picture: data.picture || '',
    tokens: data.tokens || null,
    createdAt: data.created_at || null,
    updatedAt: data.updated_at || null,
  }
}

/**
 * Get only tokens for a user.
 */
export async function getUserTokens(userId) {
  const user = await getUserById(userId)
  return user?.tokens || null
}
