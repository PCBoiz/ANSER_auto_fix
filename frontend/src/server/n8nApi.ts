// Client cho n8n Public REST API (khác `triggerN8nWebhook` trong n8n.ts, vốn chỉ gọi
// webhook URL). Dùng để điều khiển thật: bật/tắt workflow, đọc lịch sử chạy — cần API
// key tạo thủ công trong n8n UI (Settings → n8n API).

export type N8nExecutionSummary = {
  id: string | number;
  status: string;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string | null;
};

function n8nConfig() {
  const baseUrl = process.env.N8N_API_URL;
  const apiKey = process.env.N8N_API_KEY;
  return { baseUrl, apiKey, configured: Boolean(baseUrl && apiKey) };
}

export function isN8nApiConfigured() {
  return n8nConfig().configured;
}

async function n8nApiFetch(path: string, init?: RequestInit) {
  const { baseUrl, apiKey, configured } = n8nConfig();
  if (!configured) {
    throw new Error(
      "Chưa cấu hình N8N_API_URL/N8N_API_KEY — tạo API key ở n8n UI (Settings → n8n API) rồi dán vào frontend/.env.local.",
    );
  }
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": apiKey!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    // Đọc: 5 giây — dò "n8n còn sống không" phải nhanh. Ghi: 20 giây — n8n vừa khởi động
    // tạo workflow mất hơn 5 giây (đo thật: 2/9 lần tạo quá hạn dù n8n vẫn tạo xong), và báo
    // lỗi cho một việc đã thành công chỉ sinh sự cố giả.
    signal: AbortSignal.timeout(!init?.method || init.method === "GET" ? 5000 : 20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `n8n API lỗi ${res.status}${text ? `: ${text}` : ""} — kiểm tra lại Workflow ID đã liên kết và API key.`,
    );
  }
  return res.json().catch(() => ({}));
}

export async function findSmtpCredential(): Promise<{ id: string; name: string } | null> {
  const data = await n8nApiFetch(`/credentials`);
  const items: Array<{ id: string | number; name: string; type: string }> = data.data ?? [];
  const smtp = items.find((c) => c.type === "smtp");
  return smtp ? { id: String(smtp.id), name: smtp.name } : null;
}

export async function listN8nWorkflows(): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const data = await n8nApiFetch(`/workflows?limit=100`);
  const items: Array<{ id: string | number; name: string; active: boolean }> = data.data ?? [];
  return items.map((w) => ({ id: String(w.id), name: w.name, active: w.active }));
}

export type N8nWorkflowNode = {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  [key: string]: unknown;
};

export type N8nWorkflowDetail = {
  name: string;
  nodes: N8nWorkflowNode[];
  connections: unknown;
  settings?: unknown;
};

export async function createN8nWorkflow(input: {
  name: string;
  nodes: unknown;
  connections: unknown;
  settings?: unknown;
}): Promise<{ id: string }> {
  const data = await n8nApiFetch(`/workflows`, {
    method: "POST",
    body: JSON.stringify({ ...input, settings: input.settings ?? {} }),
  });
  return { id: String(data.id) };
}

export async function getN8nWorkflow(workflowId: string): Promise<N8nWorkflowDetail> {
  const data = await n8nApiFetch(`/workflows/${workflowId}`);
  return { name: data.name, nodes: data.nodes, connections: data.connections, settings: data.settings };
}

export async function updateN8nWorkflow(workflowId: string, input: N8nWorkflowDetail): Promise<void> {
  await n8nApiFetch(`/workflows/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify({ ...input, settings: input.settings ?? {} }),
  });
}

export async function activateN8nWorkflow(workflowId: string) {
  return n8nApiFetch(`/workflows/${workflowId}/activate`, { method: "POST" }) as Promise<{ active: boolean }>;
}

export async function deactivateN8nWorkflow(workflowId: string) {
  return n8nApiFetch(`/workflows/${workflowId}/deactivate`, { method: "POST" }) as Promise<{ active: boolean }>;
}

export async function listN8nExecutions(workflowId: string, limit = 10): Promise<N8nExecutionSummary[]> {
  const data = await n8nApiFetch(`/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}`);
  const items: Array<{
    id: string | number;
    status?: string;
    finished?: boolean;
    mode?: string;
    startedAt?: string;
    stoppedAt?: string | null;
  }> = data.data ?? [];

  return items.map((exec) => ({
    id: exec.id,
    status: exec.status ?? (!exec.stoppedAt ? "running" : exec.finished ? "success" : "error"),
    mode: exec.mode,
    startedAt: exec.startedAt,
    stoppedAt: exec.stoppedAt,
  }));
}
