const path = require('path');
const fs = require('fs');
const projectsService = require('./projects.service');

async function create(req, res) {
  try {
    const { title, abstract, keywords, researchType, program, course, section } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }
    if (!abstract || !abstract.trim()) {
      return res.status(400).json({ error: 'Project abstract is required' });
    }

    let parsedKeywords = [];
    if (keywords) {
      try {
        parsedKeywords = typeof keywords === 'string' ? JSON.parse(keywords) : keywords;
      } catch {
        parsedKeywords = [];
      }
    }

    const project = await projectsService.createProject({
      title: title.trim(),
      abstract: abstract.trim(),
      keywords: parsedKeywords,
      researchType: researchType || 'ieee',
      program: program || null,
      course: course || null,
      section: section || null,
      documentReference: null,
      createdBy: req.user.id,
    });

    if (req.file) {
      const publicUrl = `/uploads/files/${req.file.filename}`;

      await projectsService.addProjectFile({
        projectId: project.id,
        fileUrl: publicUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user.id,
      });

      await projectsService.updateProjectDocumentRef(project.id, publicUrl);
    }

    return res.status(201).json({
      projectId: project.id,
      projectCode: project.project_code,
    });
  } catch (err) {
    console.error('projects.controller – create error:', err);
    return res.status(500).json({ error: 'Failed to create project' });
  }
}

async function list(req, res) {
  try {
    const projects = await projectsService.getProjectsByUser(req.user.id);

    const mapped = projects.map((p) => ({
      ...p,
      keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords) : (p.keywords || []),
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('projects.controller – list error:', err);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
}

async function getOne(req, res) {
  try {
    const project = await projectsService.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.keywords = typeof project.keywords === 'string'
      ? JSON.parse(project.keywords)
      : (project.keywords || []);

    return res.json(project);
  } catch (err) {
    console.error('projects.controller – getOne error:', err);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
}

async function getMembers(req, res) {
  try {
    const members = await projectsService.getProjectMembers(req.params.id);
    return res.json(members);
  } catch (err) {
    console.error('projects.controller – getMembers error:', err);
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
}

async function getFiles(req, res) {
  try {
    const files = await projectsService.getProjectFiles(req.params.id);
    return res.json(files);
  } catch (err) {
    console.error('projects.controller – getFiles error:', err);
    return res.status(500).json({ error: 'Failed to fetch project files' });
  }
}

module.exports = {
  create,
  list,
  getOne,
  getMembers,
  getFiles,
};
