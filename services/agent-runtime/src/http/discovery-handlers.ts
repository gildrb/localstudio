import { discoverSkills, loadSkillInstructions } from "../skill-discovery";
import { discoverPromptTemplates, loadPromptTemplateInstructions } from "../prompt-templates-store";

export async function listSkills(): Promise<Response> {
  return Response.json({ skills: discoverSkills() });
}

export async function loadSkill(request: Request): Promise<Response> {
  const skillPath = new URL(request.url).searchParams.get("path") ?? "";
  const skill = skillPath ? loadSkillInstructions(skillPath) : null;
  if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });
  return Response.json({ skill });
}

export async function listPromptTemplates(): Promise<Response> {
  return Response.json({ templates: discoverPromptTemplates() });
}

export async function loadPromptTemplate(request: Request): Promise<Response> {
  const templatePath = new URL(request.url).searchParams.get("path") ?? "";
  const template = templatePath ? loadPromptTemplateInstructions(templatePath) : null;
  if (!template) return Response.json({ error: "Template not found" }, { status: 404 });
  return Response.json({ template });
}
