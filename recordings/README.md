# Raw staging recordings for Tom (not for merge)

Real speed, never sped up. Phone 390x844 at 2x (video 780x1688, 30 fps).
Signed out, on staging. Each `<flow>.steps.json` gives the second each step
happens in the video. `record.js` made them (`node record.js <flow>`).

| file | flow |
|---|---|
| collector-toy.mp4 | the hero as a printable toy: take apart, put together, Print file |
| visitor.mp4 | a shared link: the reveal, a move, home, Make a hero |
| teacher.mp4 | pay ₪100 for 10 seats (test), QR + code, a student joins and makes a hero, end the class (robot run 123) |
| buy-credits.mp4 | signed in with 0 credits → coin → Pick a pack → One hero ₪10 → TEST checkout → Pay → Credits added, coin 10 (order ec1db4d5-71f0-45f7-b723-d187404c1340; proof in buy-credits.proof.json) |
| teacher-full-teacher.mp4 + teacher-full-student.mp4 | NOT HAPPY: a full class. Two phones, same clock (start together): the student sees "This class is full"; the teacher taps More → Add seats → TEST ₪100 for 10 seats; the student goes on by themself to "What's your name?" |
| kid-happy.mp4 | a ready hero: Dance, Flip, Play → Robot Rumble round, back, Share (link copied) |

Software 3D on the recording machine is slow: in the toy flow a tap can take
up to 30 s to land. Cut the waits; the steps file says where each tap lands.
