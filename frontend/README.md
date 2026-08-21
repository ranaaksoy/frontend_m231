# Frontend

Das Frontend ruft exakt diesen Endpoint auf:

`http://127.0.0.1:8080/helloworld`

Wenn dein bestehendes Frontend bereits existiert, brauchst du nur:

```js
const response = await fetch("http://127.0.0.1:8080/helloworld");
const text = await response.text();
console.log(text);
```

Falls das Frontend auf einem anderen Origin läuft, muss CORS im Backend erlaubt werden.
