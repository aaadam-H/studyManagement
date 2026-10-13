const storageKey = (userId) => `studyhub.subject-plan.v1.${userId}`;

export function readSubjectPlan(storage, userId) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(userId)) || '[]');
    if (!Array.isArray(saved)) return [];
    const unique = new Map();
    for (const item of saved) {
      if (/^[A-Z]{3}\d{5}$/.test(item?.code) && typeof item.section === 'string' && item.section.trim() && item.section.length <= 200) unique.set(item.code, { code: item.code, section: item.section });
    }
    return [...unique.values()];
  } catch { return []; }
}


function cachePlan(storage, userId, plan) {
  try { storage?.setItem(storageKey(userId), JSON.stringify(plan)); } catch {}
}

// A null storage argument is a read-only admin view; never import an admin's local draft.
export async function loadAccountSubjectPlan(client, storage, userId) {
  const { data, error } = await client.from('subject_plans').select('subjects').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    const plan = readSubjectPlan({ getItem: () => JSON.stringify(data.subjects) }, userId);
    cachePlan(storage, userId, plan);
    return plan;
  }
  const local = readSubjectPlan(storage, userId);
  if (!local.length) return [];
  // Insert, rather than upsert, so a concurrent device cannot overwrite an existing plan.
  const { error: insertError } = await client.from('subject_plans').insert({ user_id: userId, subjects: local });
  if (insertError?.code === '23505') return loadAccountSubjectPlan(client, storage, userId);
  if (insertError) throw new Error(insertError.message);
  return local;
}

export async function saveAccountSubjectPlan(client, storage, userId, subjects) {
  const { error } = await client.from('subject_plans').upsert({ user_id: userId, subjects });
  if (error) throw new Error(error.message);
  cachePlan(storage, userId, subjects);
}
