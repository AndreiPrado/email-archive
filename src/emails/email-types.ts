import type { OutlookMessage } from "../graph/graph-types.js";

export type { OutlookMessage };

export interface FetchOptions {
  year?: number; // filtrar apenas mensagens de um ano específico
  before?: Date; // filtrar mensagens anteriores a esta data
  limit?: number; // limitar número máximo de mensagens retornadas
}
