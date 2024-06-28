# Neon Voyage

Neon Voyage is an exciting browser-based game where you pilot a sleek neon rocket through a treacherous asteroid field. Test your reflexes and see how long you can survive in this vibrant, retro-futuristic space adventure!

## Features

- Smooth, responsive rocket controls
- Dynamic obstacle generation
- Increasing difficulty as you progress
- Visually stunning neon graphics
- Realistic rocket physics and breakdown mechanics
- Score tracking
- Mobile-friendly touch controls

## How to Play

1. Open the `Optimized Neon Rocket Game HTML.html` file in a modern web browser.
2. Use the left and right arrow keys (on desktop) or the on-screen buttons (on mobile) to navigate your rocket.
3. Avoid colliding with the colorful asteroids.
4. Try to survive as long as possible and achieve the highest score!

## Game Controls

- Desktop:
  - Left Arrow: Move the rocket to the left
  - Right Arrow: Move the rocket to the right
- Mobile:
  - Left Button: Move the rocket to the left
  - Right Button: Move the rocket to the right

## Installation and Serving the Game

No installation is required to play locally! Simply download the `Optimized Neon Rocket Game HTML.html` file and open it in your web browser to start playing.

If you want to serve the game or make it accessible online, you can use Python's built-in HTTP server and ngrok. Here's how:

1. Open a terminal in the directory containing the game file.

2. Start a Python HTTP server:
   ```
   python3 -m http.server
   ```
   This will start a server on port 8000 by default.

3. In another terminal, use ngrok to expose your local server:
   ```
   ngrok http 8000
   ```

4. ngrok will provide a public URL. You can access the game by appending `/Optimized Neon Rocket Game HTML.html` to this URL.
   For example: `https://your-ngrok-url.ngrok.io/Optimized Neon Rocket Game HTML.html`

This method is great for testing or sharing the game without needing to deploy it to a web server.

## Technical Details

- The game is built using HTML5 Canvas and vanilla JavaScript.
- It features smooth animations and particle effects for an immersive experience.
- The code is optimized for performance, using techniques like off-screen rendering for stars.
- Responsive design allows for gameplay on both desktop and mobile devices.

## Customization

Feel free to modify the game to suit your preferences:

- Adjust the `CANVAS_WIDTH` and `CANVAS_HEIGHT` constants to change the game window size.
- Modify the `INITIAL_SCROLL_SPEED` constant to change the game's initial pace.
- Alter the `OBSTACLE_SPAWN_CHANCE` constant to change the frequency of asteroids.
- Customize colors and styles in the CSS section to give the game your personal touch.

## Contributing

Contributions to Neon Voyage are welcome! If you have ideas for improvements or new features, feel free to fork the repository, make your changes, and submit a pull request.

## License

This project is open source and available under the [MIT License](https://opensource.org/licenses/MIT).

Enjoy your Neon Voyage through space!