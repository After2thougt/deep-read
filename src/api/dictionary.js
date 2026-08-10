import axios from "axios";


export async function getWordDefinition(word){
const response=
await axios.get(
`http://localhost:3001/api/dictionary/${word}`
);
return response.data;
}

export async function syncVocabularyToEudic(word, contextLine) {
  const response = await axios.post("http://localhost:3001/api/eudic/vocabulary", {
    word,
    contextLine,
  });

  return response.data;
}
