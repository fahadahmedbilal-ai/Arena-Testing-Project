# The game is just static files (HTML/CSS/JS) - nginx serves them directly,
# no backend or build step needed.
FROM nginx:alpine

COPY . /usr/share/nginx/html

EXPOSE 80
