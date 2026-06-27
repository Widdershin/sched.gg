{
  routes =
    { loader, get }:
    let
      pkgs = loader.pkgs;
    in
    [
      (get "/" (
        pkgs.writeText "index.html" ''
          <html>
            <head>
              <title>Hello, Nix!</title>
            </head>
            <body>
              <h1>Hello, Nix!</h1>
            </body>
          </html>
        ''
      ))
    ];

  fantailSchemaVersion = 1;
}
