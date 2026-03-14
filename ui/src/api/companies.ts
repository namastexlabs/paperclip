import type {
  Company,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
} from "@paperclipai/shared";
import { api } from "./client";

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  create: (data: { name: string; description?: string | null; budgetMonthlyCents?: number }) =>
    api.post<Company>("/companies", data),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        "name" | "description" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents" | "brandColor"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  uploadLogo: (companyId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<{ logoUrl: string }>(`/companies/${companyId}/logo`, form);
  },
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (companyId: string, data: { include?: { company?: boolean; agents?: boolean } }) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
};
