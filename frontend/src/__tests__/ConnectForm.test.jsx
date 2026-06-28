import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { ConnectForm } from "../components/ConnectForm";

vi.mock("../api/client", () => ({
  api: { listBranches: vi.fn().mockResolvedValue({ branches: [] }) },
}));

function submit(container) {
  fireEvent.submit(container.querySelector("form"));
}

describe("ConnectForm", () => {
  it("renders the title and all input fields", () => {
    render(<ConnectForm onSubmit={() => {}} isSubmitting={false} errorMessage="" />);
    expect(screen.getByText("Indexa un repositorio")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://gitlab.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("mi-grupo/mi-proyecto")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("glpat-xxxxxxxxxxxxxxxxxxxx")).toBeInTheDocument();
  });

  it("shows URL validation error when URL is cleared", () => {
    const { container } = render(
      <ConnectForm onSubmit={() => {}} isSubmitting={false} errorMessage="" />
    );
    fireEvent.change(screen.getByPlaceholderText("https://gitlab.com"), { target: { value: "" } });
    submit(container);
    expect(screen.getByText("La URL es obligatoria")).toBeInTheDocument();
  });

  it("shows path validation error when project path is empty", () => {
    const { container } = render(
      <ConnectForm onSubmit={() => {}} isSubmitting={false} errorMessage="" />
    );
    submit(container);
    expect(screen.getByText("La ruta del proyecto es obligatoria")).toBeInTheDocument();
  });

  it("does not call onSubmit when token is empty", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <ConnectForm onSubmit={onSubmit} isSubmitting={false} errorMessage="" />
    );
    fireEvent.change(screen.getByPlaceholderText("mi-grupo/mi-proyecto"), {
      target: { value: "group/project" },
    });
    submit(container);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with trimmed payload when form is valid", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <ConnectForm onSubmit={onSubmit} isSubmitting={false} errorMessage="" />
    );
    fireEvent.change(screen.getByPlaceholderText("mi-grupo/mi-proyecto"), {
      target: { value: " group/project " },
    });
    fireEvent.change(screen.getByPlaceholderText("glpat-xxxxxxxxxxxxxxxxxxxx"), {
      target: { value: "  my-token  " },
    });
    submit(container);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        gitlab_url: "https://gitlab.com",
        project_path: "group/project",
        private_token: "my-token",
        force_reindex: false,
      })
    );
  });

  it("shows reindex mode with locked URL/path fields when prefill is provided", () => {
    const prefill = { gitlab_url: "https://git.example.com", project_path: "foo/bar" };
    render(
      <ConnectForm onSubmit={() => {}} isSubmitting={false} errorMessage="" prefill={prefill} />
    );
    expect(screen.getByText("Reindexar repositorio")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://git.example.com")).toBeDisabled();
    expect(screen.getByDisplayValue("foo/bar")).toBeDisabled();
  });

  it("displays the server error message", () => {
    render(
      <ConnectForm onSubmit={() => {}} isSubmitting={false} errorMessage="Connection refused" />
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("disables submit button while submitting", () => {
    render(<ConnectForm onSubmit={() => {}} isSubmitting={true} errorMessage="" />);
    expect(screen.getByRole("button", { name: /iniciando/i })).toBeDisabled();
  });
});
