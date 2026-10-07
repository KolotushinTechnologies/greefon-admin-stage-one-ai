import { asClass, asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from "awilix";
import type { AppEnv } from "../config/env.js";
import { MongoConnection } from "../infrastructure/mongo/mongo.client.js";
import { RedisConnection } from "../infrastructure/redis/redis.client.js";
import { JobQueues } from "../infrastructure/bullmq/queues.js";
import { RabbitEventBus } from "../infrastructure/rabbitmq/event-bus.js";
import { GreefonVedomostiClient } from "../infrastructure/crm-vedomosti/vedomosti.client.js";
import { GigaChatGateway } from "../infrastructure/llm/gigachat.gateway.js";
import type { LlmGateway } from "../infrastructure/llm/llm.types.js";
import { XenovaEmbeddingService } from "../infrastructure/embeddings/xenova.embeddings.js";
import { TelegramMessenger } from "../infrastructure/telegram/telegram.messenger.js";
import { UserRepository } from "../platform/identity/user.repository.js";
import { AuditRepository } from "../platform/identity/audit.repository.js";
import { StaffService } from "../platform/identity/staff.service.js";
import { OrgRepository } from "../platform/org/org.repository.js";
import { ChatRepository } from "../platform/org/chat.repository.js";
import { TargetResolver } from "../platform/org/target-resolver.js";
import { CrmSyncService } from "../platform/org/crm-sync.service.js";
import { ScheduleService } from "../platform/org/schedule.service.js";
import { KnowledgeRepository } from "../platform/knowledge/knowledge.repository.js";
import { KnowledgeService } from "../platform/knowledge/knowledge.service.js";
import { ConversationStore } from "../platform/conversation/conversation.store.js";
import { OutboundRepository } from "../platform/messaging/outbound.repository.js";
import { SendService } from "../platform/messaging/send.service.js";
import { AgentRuntime } from "../platform/agent-runtime/agent.runtime.js";
import { AdminAgent } from "../agents/admin/admin.agent.js";
import { ParentAgent } from "../agents/parent/parent.agent.js";
import { ParentHints } from "../agents/parent/parent.hints.js";
import { TelegramAdminChannel } from "../channels/telegram-admin/telegram.channel.js";
import { AdminPanel } from "../channels/telegram-admin/admin.panel.js";
import { EscalationRepository } from "../platform/escalation/escalation.repository.js";
import { EscalationService } from "../platform/escalation/escalation.service.js";
import { UsageMeter } from "../platform/analytics/usage.meter.js";
import { DigestService } from "../platform/analytics/digest.service.js";
import { DailyReportService } from "../platform/analytics/daily-report.service.js";
import { SchoolEventRepository } from "../platform/events/event.repository.js";
import { SchoolEventService } from "../platform/events/event.service.js";
import { CrmPeopleRepository, CrmOpsRepository } from "../platform/crm-import/crm-data.repository.js";
import { CrmImportService } from "../platform/crm-import/crm-import.service.js";
import { OsQueryService } from "../platform/os-api/os.query.js";
import { GigaChatSttService } from "../infrastructure/stt/gigachat.stt.js";
import { KnowledgeGroundingService } from "../platform/knowledge/knowledge-grounding.service.js";
import { NotesRepository } from "../platform/notes/notes.repository.js";
import { NotesService } from "../platform/notes/notes.service.js";
import { CopilotService } from "../platform/copilot/copilot.service.js";
import { AiActionLogRepository } from "../platform/copilot/ai-action-log.repository.js";
import { ContextHintsService } from "../platform/copilot/context-hints.service.js";
import { ProblemRadarService } from "../platform/copilot/problem-radar.service.js";
import { LeadRepository } from "../platform/copilot/lead.repository.js";
import { SalesCoachService } from "../platform/copilot/sales-coach.service.js";
import { ClientCardService } from "../platform/copilot/client-card.service.js";
import { ParentInboundDeskService } from "../platform/copilot/parent-inbound-desk.service.js";
import { CrmLinkRepository } from "../platform/copilot/crm-link.repository.js";
import { CrmLinkService } from "../platform/copilot/crm-link.service.js";
import { CrmFunnelRepository } from "../platform/crm-import/crm-funnel.repository.js";

export type AppCradle = {
  env: AppEnv;
  mongo: MongoConnection;
  redis: RedisConnection;
  queues: JobQueues;
  events: RabbitEventBus;
  crm: GreefonVedomostiClient;
  llm: LlmGateway;
  embeddings: XenovaEmbeddingService;
  messenger: TelegramMessenger;
  stt: GigaChatSttService;
  knowledgeGrounding: KnowledgeGroundingService;
  notesDocs: NotesRepository;
  notes: NotesService;
  users: UserRepository;
  audit: AuditRepository;
  staff: StaffService;
  org: OrgRepository;
  chats: ChatRepository;
  resolver: TargetResolver;
  crmSync: CrmSyncService;
  crmPeople: CrmPeopleRepository;
  crmOps: CrmOpsRepository;
  crmImport: CrmImportService;
  osQuery: OsQueryService;
  schedule: ScheduleService;
  knowledgeDocs: KnowledgeRepository;
  knowledge: KnowledgeService;
  conversations: ConversationStore;
  outbound: OutboundRepository;
  send: SendService;
  runtime: AgentRuntime;
  adminAgent: AdminAgent;
  parentAgent: ParentAgent;
  parentHints: ParentHints;
  panel: AdminPanel;
  telegramChannel: TelegramAdminChannel;
  escalationDocs: EscalationRepository;
  escalationService: EscalationService;
  copilot: CopilotService;
  salesCoach: SalesCoachService;
  leads: LeadRepository;
  clientCard: ClientCardService;
  parentInboundDesk: ParentInboundDeskService;
  crmLinkDocs: CrmLinkRepository;
  crmLinks: CrmLinkService;
  crmFunnel: CrmFunnelRepository;
  contextHints: ContextHintsService;
  problemRadar: ProblemRadarService;
  aiActions: AiActionLogRepository;
  usage: UsageMeter;
  digest: DigestService;
  dailyReport: DailyReportService;
  schoolEventDocs: SchoolEventRepository;
  schoolEvents: SchoolEventService;
};

export function buildContainer(env: AppEnv): AwilixContainer<AppCradle> {
  const container = createContainer<AppCradle>({ injectionMode: InjectionMode.CLASSIC });

  container.register({
    env: asValue(env),
    mongo: asClass(MongoConnection).singleton(),
    redis: asClass(RedisConnection).singleton(),
    queues: asFunction((redis: RedisConnection) => new JobQueues(redis.client)).singleton(),
    events: asClass(RabbitEventBus).singleton(),
    crm: asClass(GreefonVedomostiClient).singleton(),
    llm: asClass(GigaChatGateway).singleton(),
    embeddings: asClass(XenovaEmbeddingService).singleton(),
    messenger: asClass(TelegramMessenger).singleton(),
    stt: asClass(GigaChatSttService).singleton(),
    notesDocs: asClass(NotesRepository).singleton(),
    notes: asClass(NotesService).singleton(),
    users: asClass(UserRepository).singleton(),
    audit: asClass(AuditRepository).singleton(),
    staff: asClass(StaffService).singleton(),
    org: asClass(OrgRepository).singleton(),
    chats: asClass(ChatRepository).singleton(),
    resolver: asClass(TargetResolver).singleton(),
    crmSync: asClass(CrmSyncService).singleton(),
    crmPeople: asClass(CrmPeopleRepository).singleton(),
    crmOps: asClass(CrmOpsRepository).singleton(),
    crmImport: asClass(CrmImportService).singleton(),
    osQuery: asClass(OsQueryService).singleton(),
    schedule: asClass(ScheduleService).singleton(),
    knowledgeDocs: asClass(KnowledgeRepository).singleton(),
    knowledge: asClass(KnowledgeService).singleton(),
    knowledgeGrounding: asClass(KnowledgeGroundingService).singleton(),
    conversations: asClass(ConversationStore).singleton(),
    outbound: asClass(OutboundRepository).singleton(),
    send: asClass(SendService).singleton(),
    runtime: asFunction((llm: LlmGateway, conversations: ConversationStore) => new AgentRuntime(llm, conversations)).singleton(),
    adminAgent: asClass(AdminAgent).singleton(),
    parentAgent: asClass(ParentAgent).singleton(),
    parentHints: asClass(ParentHints).singleton(),
    panel: asClass(AdminPanel).singleton(),
    telegramChannel: asClass(TelegramAdminChannel).singleton(),
    escalationDocs: asClass(EscalationRepository).singleton(),
    aiActions: asClass(AiActionLogRepository).singleton(),
    contextHints: asClass(ContextHintsService).singleton(),
    problemRadar: asClass(ProblemRadarService).singleton(),
    salesCoach: asClass(SalesCoachService).singleton(),
    leads: asClass(LeadRepository).singleton(),
    crmLinkDocs: asClass(CrmLinkRepository).singleton(),
    crmFunnel: asClass(CrmFunnelRepository).singleton(),
    crmLinks: asClass(CrmLinkService).singleton(),
    clientCard: asClass(ClientCardService).singleton(),
    copilot: asClass(CopilotService).singleton(),
    parentInboundDesk: asClass(ParentInboundDeskService).singleton(),
    escalationService: asClass(EscalationService).singleton(),
    usage: asClass(UsageMeter).singleton(),
    digest: asClass(DigestService).singleton(),
    dailyReport: asClass(DailyReportService).singleton(),
    schoolEventDocs: asClass(SchoolEventRepository).singleton(),
    schoolEvents: asClass(SchoolEventService).singleton(),
  });

  return container;
}
