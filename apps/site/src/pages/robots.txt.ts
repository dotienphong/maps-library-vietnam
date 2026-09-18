import type { APIRoute } from 'astro';
import { noiDungRobots } from '../lib/robots';

export const GET: APIRoute = () =>
  new Response(noiDungRobots(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
