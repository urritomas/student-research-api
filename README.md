# Work flow

### Technologies
- Node.js
- Express
- Nodemon

## repository status
- Default branch: `main`
- Scripts (from package.json): 
    - `npm start` -> `node src/server.js`
    - `npm run dev` -> `nodemon src/server.js`

## Prerequisites
- Node.js (LTS recommended)
- npm

## Install
1. Clone the repo: 
- `git clone https://github.com/urritomas/student-research-api.git`
- `cd student-research-api`

2. Copy the .env file
- `copy .env.example .env`
- Populate the .env file
> NOTE: DO NOT COMMIT `.env` INTO THE REPOSITORY!!

3. Install dependencies:
- `npm install` or `pnpm install` or `yarn install`

## Running the app
- `npm run dev`

Production / simple run

- `npm start`
<hr>

# Github workflow

## Making a pull request

- `git checkout -b [branch name]`
- `git add .`
- `git commit -m "[commit message]"`
- `git push origin [branch name]`

## Branching model

- main — production-ready code
- feature/<name> - new features
- fix/<description> - bug fixes
- chore/<description> - tassk that don't change the app logic

>NOTE: These apply to commit messages too.

## Creating Pull Requests
- Create a branch from `main`
- Implement your change and add tests where appropriate
- Open a Pull Request describing what you changed and why, and any migration notes
- Get at least one reviewer to approve before merging

## Commit Messages
- feat: add new enpoint for X
- fix: correct validation for Y
- chore: update dependencies

# API Documentation
for now please use API.md to document the endpoints