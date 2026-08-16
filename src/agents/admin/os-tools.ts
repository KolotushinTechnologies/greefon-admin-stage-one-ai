import type { RegisteredTool } from "../../platform/agent-runtime/types.js";
import type { OsQueryService } from "../../platform/os-api/os.query.js";

export function buildOsTools(os: OsQueryService): RegisteredTool[] {
  return [
    {
      name: "get_os_insights",
      description:
        "Срез штабной OS: статусы учеников, вероятность недоплаты/оттока, нагрузка залов, предложения по развитию ITF МФТ. Вызывай для цифр и графиков.",
      minRole: "operator",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          branch_crm_id: { type: "string", description: "CRM id филиала или пусто для всех" },
        },
      },
      handler: async (input) => {
        const branchCrmId = typeof input.branch_crm_id === "string" && input.branch_crm_id.trim().length > 0 ? input.branch_crm_id.trim() : undefined;
        return os.insights(branchCrmId ? { branchCrmId } : {});
      },
    },
  ];
}
