<h1 align="center"><img style="width: 10%" stlye="" src="https://upload.wikimedia.org/wikipedia/commons/0/0e/Place_2022.svg"/>

Rplace Clone</h1>

> [!WARNING]
> This clone is still in development

## Get Started:
* Install [Node.js](https://nodejs.org/en) and restart your computer to ensure it's properly set up. 
* Clone this repo or download zip, and extract the folder
* Open the terminal in the project folder, and run `npm install` to install all required dependencies
* To get started with convex run `npx convex dev`.
* After authentication and creating a new project, decide whether you want to work in production or development mode — you must set the environment variables in the same environment you plan to run the project in, or it will not work.
* In your chosen environment’s Project Settings → Environment Variables tab, add: 

`palette` with value:
```
["#6d011b","#bd0038","#ff4500","#ffa800","#ffd636","#fff8b9","#00a468","#00cc77","#7fed56","#00756f","#009eaa","#00ccc0","#2350a3","#368fe9","#51e9f4","#4a3ac1","#6b5cff","#93b3fe","#811e9f","#b34ac0","#e5abff","#de107f","#ff3881","#ff98a9","#6d482e","#9c6927","#ffb470","#000000","#515352","#898d90","#d3d7da","#ffffff"]

```
`SIZE` with the value #,# (replace with your desired canvas width and height).
## Deploying to Vercel
* If you want to publish this project, in this example we’ll use Vercel.
* Log in to Vercel (or create an account if you don’t have one), and connect Vercel to your repository.
* Go to Build & Output Settings and override the build command with:
```
npx convex deploy --cmd 'npm run build'
```
Add an environment variable named `CONVEX_DEPLOY_KEY`.
* To get this value, go to your Convex Project Settings → Deploy Keys, and generate a new deploy key.
* Once everything is set, press the Deploy button and visit the URL that Vercel automatically assigns to your project.

