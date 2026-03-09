import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 20,
  duration: "1m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const health = http.get(`${BASE}/health`);
  check(health, {
    "health endpoint up": (r) => r.status === 200,
  });
  sleep(0.2);
}
