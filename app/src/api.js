async function request(path, method = 'GET', body) {
  const res = await fetch('/api/lessons' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export const listLessons = () => request('');
export const createLesson = (title) => request('', 'POST', { title });
export const deleteLesson = (id) => request(`/${id}`, 'DELETE');
export const addStudent = (lessonId, name) => request(`/${lessonId}/students`, 'POST', { name });
export const deleteStudent = (lessonId, studentId) => request(`/${lessonId}/students/${studentId}`, 'DELETE');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // navigator.clipboard работает только в secure context (HTTPS/localhost)
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
