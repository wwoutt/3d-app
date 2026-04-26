# 3D Print Manager

## What this project is

3D Print Manager is a local web app for small 3D printing workflows. It helps you track filament, other purchased parts, product costs, sales, and overall profit or loss in one place.

The app is built for makers, hobby businesses, and small print shops that want a simple way to answer questions like:

- How much did this product really cost to make?
- How much filament is left in stock?
- How much have I spent on nozzles, build plates, magnets, screws, or packaging?
- Am I making profit or losing money overall?

## What the app does

The app currently supports:

- Material management
  - Add filament materials and colors
  - Track filament stock in grams
  - Register filament purchases
- Product management
  - Create printable products
  - Store weight, print time, work time, links, and image URLs
  - Add per-product parts such as magnets, screws, or inserts
- Print and sales tracking
  - Record sold prints
  - Calculate estimated cost and suggested sale price
  - Show profit per sale
- Other parts tracking
  - Track non-print-specific parts such as nozzles, build plates, tools, or spare hardware
  - Register purchases and stock levels
- Reporting
  - Show revenue, print costs, material usage, labor, electricity, purchased parts, and net result
  - Show stock value and average filament price per kilogram

## Local-first storage

This app runs locally in your browser and stores its data locally on your machine.

- It uses [Dexie.js](https://dexie.org/docs), which is a wrapper around browser [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- Your data is not sent to a cloud backend by this project
- Your database is stored in the browser profile you use to open the app
- If you open the app in a different browser or clear browser storage, your data will not automatically follow you

Because of that, it is a good idea to use the built-in export feature regularly.

## Tech stack

- [React](https://react.dev/)
- [Vite](https://vite.dev/guide/)
- [Dexie.js](https://dexie.org/docs)
- [Recharts](https://recharts.org/)

## Requirements

To run this project locally, you need:

1. [Node.js](https://nodejs.org/en/download/)
2. [npm](https://docs.npmjs.com/getting-started)
3. A modern browser such as Chrome, Edge, Firefox, or Safari
4. Git is recommended if you want to clone the repository and keep it updated

## Documentation links

If you want the official documentation for the tools used in this project:

- Node.js download and installation: [nodejs.org/en/download](https://nodejs.org/en/download/)
- npm getting started guide: [docs.npmjs.com/getting-started](https://docs.npmjs.com/getting-started)
- React documentation: [react.dev](https://react.dev/)
- Vite getting started guide: [vite.dev/guide](https://vite.dev/guide/)
- Dexie.js documentation: [dexie.org/docs](https://dexie.org/docs)
- Recharts documentation: [recharts.org](https://recharts.org/)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/wwoutt/3d-app.git
cd 3d-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

### 4. Open the app in your browser

Vite will show a local address in the terminal, usually:

```text
http://localhost:5173
```

Open that URL in your browser.

## Build for production

If you want to create a production build:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## How to use the app

### 1. Add filament materials

Go to `Materialen` and:

1. Add a material type
2. Add one or more colors for that material
3. Adjust stock if needed

### 2. Register filament purchases

Go to `Inkopen` and:

1. Select a color
2. Enter the weight in grams
3. Enter the total purchase price
4. Save the purchase

This is used to estimate the average filament cost per kilogram.

### 3. Add products

Go to `Producten` and:

1. Enter the product name
2. Enter filament weight
3. Enter print time
4. Enter work time
5. Optionally add a product link and image URL
6. Add per-product parts if the item always includes extras
7. Save the product

### 4. Track other purchased parts

Go to `Overige onderdelen` and:

1. Add parts such as nozzles, build plates, packaging, magnets, screws, or tools
2. Optionally add a category
3. Register purchases with quantity and total cost
4. Update stock when needed

Use this section for items that are part of your business costs but not always tied to a single print.

### 5. Record prints or sales

Go to `Print` and:

1. Select a product
2. Select the filament color used
3. Enter the quantity
4. Enter the sale price
5. Save the sale

The app calculates:

- Filament cost
- Product-part cost
- Electricity cost
- Labor cost
- Total cost
- Suggested sale price
- Profit

### 6. Review business performance

Go to `Overzicht` to see:

- Revenue from sales
- Material cost used in sold prints
- Product part cost
- Electricity cost
- Labor cost
- Total print cost
- Gross print profit
- Material purchase spending
- Other parts purchase spending
- Net result including purchases
- Estimated stock value

## Backup and restore

The app includes a local export/import flow.

To export:

1. Open `Instellingen`
2. Click `Export`
3. Save the generated JSON backup file

To restore:

1. Open `Instellingen`
2. Choose a previously exported JSON file
3. Import it into the app

## Notes and limitations

- This project is local-first, not a hosted SaaS product
- Data is stored in the current browser profile
- There is no user login system
- There is no server database included
- There is no automatic cloud sync

## Version

The app version is managed in `package.json` and shown inside the UI.
