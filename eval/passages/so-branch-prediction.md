---
id: so-branch-prediction
category: tech-blog
title: Why is processing a sorted array faster than processing an unsorted array?
url: https://stackoverflow.com/a/11227902
author: Mysticial (Stack Overflow answer)
license: CC BY-SA 4.0
note: excerpt; images and the quick-visualization block omitted
---
You are a victim of branch prediction fail.

## What is Branch Prediction?

Consider a railroad junction. Now for the sake of argument, suppose this is back in the 1800s - before long-distance or radio communication.

You are a blind operator of a junction and you hear a train coming. You have no idea which way it is supposed to go. You stop the train to ask the driver which direction they want. And then you set the switch appropriately.

Trains are heavy and have a lot of inertia, so they take forever to start up and slow down.

Is there a better way? You guess which direction the train will go! If you guessed right, it continues on. If you guessed wrong, the driver will stop, back up, and yell at you to flip the switch. Then it can restart down the other path.

If you guess right every time, the train will never have to stop. If you guess wrong too often, the train will spend a lot of time stopping, backing up, and restarting.

Consider an if-statement: At the processor level, it is a branch instruction. You are a processor and you see a branch. You have no idea which way it will go. What do you do? You halt execution and wait until the previous instructions are complete. Then you continue down the correct path.

This is branch prediction. I admit it's not the best analogy since the train could just signal the direction with a flag. But in computers, the processor doesn't know which direction a branch will go until the last moment.

As hinted from above, the culprit is this if-statement:

```c
if (data[c] >= 128)
    sum += data[c];
```

Notice that the data is evenly distributed between 0 and 255. When the data is sorted, roughly the first half of the iterations will not enter the if-statement. After that, they will all enter the if-statement. This is very friendly to the branch predictor since the branch consecutively goes the same direction many times.
