export default function handler(req) {
  return new Response('Hello! It works.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
