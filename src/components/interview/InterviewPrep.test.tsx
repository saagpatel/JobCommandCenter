import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { commands } from "@/lib/tauri-bindings";
import { InterviewPrep } from "./InterviewPrep";

function renderWithProviders(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

describe("InterviewPrep", () => {
	it("shows empty state when no interviewing jobs", async () => {
		vi.mocked(commands.listJobs).mockResolvedValue({
			status: "ok",
			data: [],
		});

		renderWithProviders(<InterviewPrep />);

		expect(
			await screen.findByText("No jobs in Interview stage"),
		).toBeInTheDocument();
	});

	it("shows job list when interviewing jobs exist", async () => {
		vi.mocked(commands.listJobs).mockResolvedValue({
			status: "ok",
			data: [
				{
					id: "j1",
					company: "Acme Corp",
					role: "Senior Engineer",
					ats: "greenhouse",
					apply_url: "https://acme.com/apply",
					job_posting_id: null,
					board_token: null,
					status: "interviewing",
					tier: "tier1",
					source: null,
					resume_path: null,
					cover_letter_path: null,
					custom_fields: null,
					notes: null,
					applied_at: "2026-03-01",
					follow_up_date: null,
					response_date: null,
					salary_range: null,
					location: null,
					jd_url: null,
					source_packet_id: null,
					source_packet_version: null,
					truth_status: null,
					created_at: "2026-03-01",
					updated_at: "2026-03-01",
				},
			],
		});

		renderWithProviders(<InterviewPrep />);

		expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
		expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
	});

	it("shows header with count badge", async () => {
		vi.mocked(commands.listJobs).mockResolvedValue({
			status: "ok",
			data: [
				{
					id: "j1",
					company: "Test Co",
					role: "Dev",
					ats: "ashby",
					apply_url: "https://test.com",
					job_posting_id: null,
					board_token: null,
					status: "interviewing",
					tier: "tier1",
					source: null,
					resume_path: null,
					cover_letter_path: null,
					custom_fields: null,
					notes: null,
					applied_at: null,
					follow_up_date: null,
					response_date: null,
					salary_range: null,
					location: null,
					jd_url: null,
					source_packet_id: null,
					source_packet_version: null,
					truth_status: null,
					created_at: "2026-03-01",
					updated_at: "2026-03-01",
				},
			],
		});

		renderWithProviders(<InterviewPrep />);

		expect(await screen.findByText("Test Co")).toBeInTheDocument();
		expect(screen.getByText("Interview Prep")).toBeInTheDocument();
	});
});
