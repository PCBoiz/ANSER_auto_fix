import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Chạy THẬT đoạn mã của node "Đánh giá + chống spam" trong n8n-workflows/app_watchdog.json —
// nửa vòng lặp nằm trong n8n. Không có test này thì chỉ biết nó đúng khi app đã chết thật và
// hộp thư của chủ gara nhận (hoặc không nhận, hoặc nhận 10 email).

type Result = { send: boolean; subject: string; html: string; status: string };

const workflow = JSON.parse(readFileSync(join(process.cwd(), "n8n-workflows", "app_watchdog.json"), "utf-8"));
const code: string = workflow.nodes.find((n: { name: string }) => n.name === "Đánh giá + chống spam").parameters.jsCode;

function makeRunner() {
  const state: Record<string, unknown> = {}; // $getWorkflowStaticData('global') — sống qua các lần chạy
  let clock = Date.parse("2026-09-18T01:00:00Z");
  class FakeDate extends Date {
    constructor(...args: [] | [number]) {
      super(...(args.length ? args : [clock]) as [number]);
    }
    static now() {
      return clock;
    }
  }
  const fn = new Function("$json", "$getWorkflowStaticData", "Date", code) as (
    json: unknown,
    getState: () => Record<string, unknown>,
    date: DateConstructor,
  ) => Array<{ json: Result }>;
  return {
    state,
    advance(minutes: number) {
      clock += minutes * 60_000;
    },
    run(response: unknown): Result {
      return fn(response, () => state, FakeDate as unknown as DateConstructor)[0].json;
    },
  };
}

const healthy = { statusCode: 200, body: { status: "ok", checks: [] } };
const degraded = {
  statusCode: 503,
  body: { status: "degraded", checks: [{ name: "Sự cố vòng tự động", ok: false, detail: "Không liên lạc được với n8n" }] },
};
const unreachable = { error: { message: "connect ECONNREFUSED" } };

describe("Workflow canh gác app (chạy trong n8n)", () => {
  it("app khoẻ -> im lặng", () => {
    expect(makeRunner().run(healthy).send).toBe(false);
  });

  it("app không kết nối được -> báo ngay lần đầu", () => {
    const r = makeRunner().run(unreachable);
    expect(r.send).toBe(true);
    expect(r.subject).toContain("không phản hồi");
    expect(r.subject).not.toContain("nhắc lại");
  });

  it("vòng tự động hỏng (503 degraded) -> báo, kèm lý do từ /api/health", () => {
    const r = makeRunner().run(degraded);
    expect(r.send).toBe(true);
    expect(r.subject).toContain("vòng tự động đang hỏng");
    expect(r.html).toContain("Không liên lạc được với n8n");
  });

  it("hỏng kéo dài: KHÔNG gửi mỗi 30 phút, nhắc lại sau 3 giờ", () => {
    const w = makeRunner();
    expect(w.run(unreachable).send).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      w.advance(30); // 30 phút … 2 giờ 30
      expect(w.run(unreachable).send).toBe(false);
    }
    w.advance(31); // 3 giờ 01
    const again = w.run(unreachable);
    expect(again.send).toBe(true);
    expect(again.subject).toContain("nhắc lại");
  });

  it("app sống lại -> báo 'đã hoạt động lại' kèm thời gian gián đoạn, rồi xoá trạng thái", () => {
    const w = makeRunner();
    w.run(unreachable);
    w.advance(90);
    const back = w.run(healthy);
    expect(back.send).toBe(true);
    expect(back.subject).toContain("đã hoạt động lại");
    expect(back.html).toContain("1 giờ 30 phút");
    expect(w.state.downSince).toBeNull();

    // Khép vòng xong thì lần khoẻ tiếp theo im lặng, và lần hỏng sau lại là "lần đầu".
    w.advance(30);
    expect(w.run(healthy).send).toBe(false);
    w.advance(30);
    expect(w.run(unreachable).subject).not.toContain("nhắc lại");
  });
});
